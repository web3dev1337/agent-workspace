const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const { getWorkspaceServiceManifest } = require('./workspaceServiceStackService');
const { getShellKind, buildShellCommand } = require('./utils/shellCommand');
const { buildPowerShellArgs } = require('./utils/processUtils');

class ServiceStackRuntimeService {
  constructor({
    workspaceManager = null,
    sessionManager = null,
    configPromoterService = null,
    io = null,
    logger = console,
    monitorIntervalMs = 5000
  } = {}) {
    this.workspaceManager = workspaceManager;
    this.sessionManager = sessionManager;
    this.configPromoterService = configPromoterService;
    this.io = io;
    this.logger = logger;
    this.monitorIntervalMs = Number.isFinite(monitorIntervalMs) ? monitorIntervalMs : 5000;
    this.workspaceState = new Map();
    this.monitorTimer = null;
  }

  static getInstance(options = {}) {
    if (!ServiceStackRuntimeService.instance) {
      ServiceStackRuntimeService.instance = new ServiceStackRuntimeService(options);
    }
    return ServiceStackRuntimeService.instance;
  }

  init({ workspaceManager, sessionManager, configPromoterService, io } = {}) {
    if (workspaceManager) this.workspaceManager = workspaceManager;
    if (sessionManager) this.sessionManager = sessionManager;
    if (configPromoterService) this.configPromoterService = configPromoterService;
    if (io) this.io = io;
    this.startMonitor();
  }

  startMonitor() {
    this.stopMonitor();
    if (this.monitorIntervalMs <= 0) return;
    this.monitorTimer = setInterval(() => {
      this.tick().catch((error) => {
        this.logger.warn?.('Service stack runtime monitor tick failed', { error: error.message });
      });
    }, this.monitorIntervalMs);
  }

  stopMonitor() {
    if (!this.monitorTimer) return;
    clearInterval(this.monitorTimer);
    this.monitorTimer = null;
  }

  buildSessionId(workspaceId, serviceId) {
    return `${workspaceId}-svc-${serviceId}`;
  }

  getWorkspaceState(workspaceId, create = false) {
    const id = String(workspaceId || '').trim();
    if (!id) return null;
    let state = this.workspaceState.get(id);
    if (!state && create) {
      state = {
        updatedAt: Date.now(),
        services: new Map()
      };
      this.workspaceState.set(id, state);
    }
    return state;
  }

  getWorkspace(workspaceId) {
    if (!this.workspaceManager || typeof this.workspaceManager.getWorkspace !== 'function') {
      throw new Error('Workspace manager unavailable');
    }
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return workspace;
  }

  getManifestServices(workspaceId, { serviceIds = [] } = {}) {
    const workspace = this.getWorkspace(workspaceId);
    const manifest = (this.configPromoterService && typeof this.configPromoterService.resolveWorkspaceManifest === 'function')
      ? this.configPromoterService.resolveWorkspaceManifest(workspace)
      : getWorkspaceServiceManifest(workspace);
    const selected = new Set((Array.isArray(serviceIds) ? serviceIds : [])
      .map((id) => String(id || '').trim().toLowerCase())
      .filter(Boolean));
    let services = Array.isArray(manifest.services) ? manifest.services : [];
    if (selected.size) {
      services = services.filter((service) => selected.has(String(service.id || '').trim().toLowerCase()));
    }
    return { workspace, services };
  }

  getDefaultWorkspaceCwd(workspace) {
    if (workspace?.repository?.path) return workspace.repository.path;
    const terminals = Array.isArray(workspace?.terminals) ? workspace.terminals : [];
    for (const terminal of terminals) {
      const terminalPath = String(terminal?.worktreePath || terminal?.repository?.path || '').trim();
      if (terminalPath) return terminalPath;
    }
    if (process.env.ORCHESTRATOR_DATA_DIR) {
      return process.env.HOME || os.homedir() || process.cwd();
    }
    return process.cwd();
  }

  emitState(workspaceId) {
    if (!this.io || typeof this.io.emit !== 'function') return;
    this.io.emit('service-stack-runtime-updated', { workspaceId });
  }

  getSessionStatus(sessionId) {
    if (!this.sessionManager || typeof this.sessionManager.getSessionById !== 'function') return null;
    return this.sessionManager.getSessionById(sessionId) || null;
  }

  startService(workspaceId, workspace, service, reason = 'manual') {
    if (!this.sessionManager || typeof this.sessionManager.createSession !== 'function') {
      throw new Error('Session manager unavailable');
    }
    const serviceId = String(service.id || '').trim();
    const sessionId = this.buildSessionId(workspaceId, serviceId);
    const existing = this.getSessionStatus(sessionId);
    if (existing) return { started: false, sessionId, alreadyRunning: true };

    const shellKind = getShellKind();
    const cwd = String(service.cwd || this.getDefaultWorkspaceCwd(workspace) || '').trim();
    const serviceCommand = buildShellCommand({
      shellKind,
      cwd,
      env: service.env || null,
      command: service.command
    });

    const command = shellKind === 'powershell' ? 'powershell.exe' : 'bash';
    const args = shellKind === 'powershell'
      ? buildPowerShellArgs(serviceCommand)
      : ['-lc', serviceCommand];

    this.sessionManager.createSession(sessionId, {
      command,
      args,
      cwd,
      type: 'service',
      worktreeId: `service:${serviceId}`,
      repositoryName: String(workspace?.name || workspaceId),
      repositoryType: 'service-stack',
      timeoutMs: 0
    });

    const state = this.getWorkspaceState(workspaceId, true);
    const runtime = state.services.get(serviceId) || {};
    state.services.set(serviceId, {
      ...runtime,
      id: serviceId,
      name: service.name,
      desired: true,
      restartPolicy: service.restartPolicy || 'never',
      lastStartAt: Date.now(),
      lastStartReason: reason,
      updatedAt: Date.now()
    });
    state.updatedAt = Date.now();
    this.emitState(workspaceId);
    return { started: true, sessionId, alreadyRunning: false };
  }

  stopService(workspaceId, serviceId, reason = 'manual') {
    const id = String(serviceId || '').trim();
    if (!id) return { stopped: false };
    const sessionId = this.buildSessionId(workspaceId, id);
    if (this.sessionManager && typeof this.sessionManager.terminateSession === 'function') {
      this.sessionManager.terminateSession(sessionId);
    }

    const state = this.getWorkspaceState(workspaceId, true);
    const runtime = state.services.get(id) || { id };
    state.services.set(id, {
      ...runtime,
      desired: false,
      lastStopAt: Date.now(),
      lastStopReason: reason,
      updatedAt: Date.now()
    });
    state.updatedAt = Date.now();
    this.emitState(workspaceId);
    return { stopped: true, sessionId };
  }

  start(workspaceId, { serviceIds = [] } = {}) {
    const workspaceIdValue = String(workspaceId || '').trim();
    if (!workspaceIdValue) throw new Error('workspaceId is required');
    const { workspace, services } = this.getManifestServices(workspaceIdValue, { serviceIds });
    const enabled = services.filter((service) => service.enabled !== false);
    const results = enabled.map((service) => this.startService(workspaceIdValue, workspace, service, 'manual'));
    return {
      workspaceId: workspaceIdValue,
      requested: services.length,
      started: results.filter((item) => item.started).length,
      running: results.filter((item) => item.alreadyRunning).length
    };
  }

  stop(workspaceId, { serviceIds = [] } = {}) {
    const workspaceIdValue = String(workspaceId || '').trim();
    if (!workspaceIdValue) throw new Error('workspaceId is required');
    const { services } = this.getManifestServices(workspaceIdValue, { serviceIds });
    const results = services.map((service) => this.stopService(workspaceIdValue, service.id, 'manual'));
    return {
      workspaceId: workspaceIdValue,
      requested: services.length,
      stopped: results.filter((item) => item.stopped).length
    };
  }

  restart(workspaceId, { serviceIds = [] } = {}) {
    const workspaceIdValue = String(workspaceId || '').trim();
    if (!workspaceIdValue) throw new Error('workspaceId is required');
    const { workspace, services } = this.getManifestServices(workspaceIdValue, { serviceIds });
    const enabled = services.filter((service) => service.enabled !== false);
    for (const service of enabled) {
      this.stopService(workspaceIdValue, service.id, 'restart');
    }
    const results = enabled.map((service) => this.startService(workspaceIdValue, workspace, service, 'restart'));
    return {
      workspaceId: workspaceIdValue,
      requested: enabled.length,
      restarted: results.filter((item) => item.started || item.alreadyRunning).length
    };
  }

  async checkHealth(service, running) {
    const healthcheck = service?.healthcheck || null;
    if (!running) return { status: 'down', reason: 'not_running' };
    if (!healthcheck) return { status: 'unknown', reason: 'no_healthcheck' };

    if (healthcheck.type === 'process') {
      return { status: 'up', reason: 'process_running' };
    }

    if (healthcheck.type === 'tcp') {
      const timeoutMs = Math.max(1000, Number(healthcheck.intervalSeconds || 30) * 100);
      const ok = await new Promise((resolve) => {
        const socket = net.createConnection({
          host: healthcheck.host || '127.0.0.1',
          port: Number(healthcheck.port)
        });
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          try { socket.destroy(); } catch {}
          resolve(value);
        };
        socket.setTimeout(timeoutMs, () => finish(false));
        socket.on('connect', () => finish(true));
        socket.on('error', () => finish(false));
      });
      return ok ? { status: 'up', reason: 'tcp_connect_ok' } : { status: 'degraded', reason: 'tcp_connect_failed' };
    }

    if (healthcheck.type === 'http') {
      const url = new URL(healthcheck.url);
      const client = url.protocol === 'https:' ? https : http;
      const timeoutMs = Math.max(1000, Number(healthcheck.intervalSeconds || 30) * 100);
      const ok = await new Promise((resolve) => {
        const req = client.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
          const status = Number(res.statusCode || 0);
          resolve(status >= 200 && status < 400);
          res.resume();
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          try { req.destroy(); } catch {}
          resolve(false);
        });
        req.end();
      });
      return ok ? { status: 'up', reason: 'http_ok' } : { status: 'degraded', reason: 'http_failed' };
    }

    return { status: 'unknown', reason: 'unsupported_healthcheck' };
  }

  async getRuntimeStatus(workspaceId) {
    const workspaceIdValue = String(workspaceId || '').trim();
    if (!workspaceIdValue) throw new Error('workspaceId is required');
    const { services } = this.getManifestServices(workspaceIdValue, {});
    const state = this.getWorkspaceState(workspaceIdValue, true);
    const out = [];
    for (const service of services) {
      const sessionId = this.buildSessionId(workspaceIdValue, service.id);
      const session = this.getSessionStatus(sessionId);
      const runtime = state.services.get(service.id) || {};
      const running = !!session;
      const health = await this.checkHealth(service, running);
      out.push({
        id: service.id,
        name: service.name,
        sessionId,
        command: service.command,
        restartPolicy: service.restartPolicy || runtime.restartPolicy || 'never',
        desired: runtime.desired === true,
        running,
        status: running ? String(session.status || 'idle') : 'stopped',
        health,
        lastStartAt: runtime.lastStartAt || null,
        lastStopAt: runtime.lastStopAt || null,
        lastStartReason: runtime.lastStartReason || null,
        lastStopReason: runtime.lastStopReason || null
      });
    }
    return {
      workspaceId: workspaceIdValue,
      count: out.length,
      services: out
    };
  }

  async tick() {
    for (const [workspaceId, state] of this.workspaceState.entries()) {
      const { workspace, services } = this.getManifestServices(workspaceId, {});
      for (const service of services) {
        const runtime = state.services.get(service.id);
        if (!runtime || runtime.desired !== true) continue;

        const sessionId = this.buildSessionId(workspaceId, service.id);
        const running = !!this.getSessionStatus(sessionId);
        if (running) continue;

        const policy = String(runtime.restartPolicy || service.restartPolicy || 'never').trim().toLowerCase();
        if (policy === 'never') {
          state.services.set(service.id, {
            ...runtime,
            desired: false,
            lastStopAt: Date.now(),
            lastStopReason: 'service_exited',
            updatedAt: Date.now()
          });
          continue;
        }

        try {
          this.startService(workspaceId, workspace, service, 'auto-restart');
        } catch (error) {
          this.logger.warn?.('Service auto-restart failed', {
            workspaceId,
            serviceId: service.id,
            error: error.message
          });
        }
      }
      state.updatedAt = Date.now();
      this.emitState(workspaceId);
    }
  }
}

module.exports = { ServiceStackRuntimeService };
