class PolicyService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.userSettingsService = null;
    this.commandRegistry = null;
  }

  static getInstance(options = {}) {
    if (!PolicyService.instance) {
      PolicyService.instance = new PolicyService(options);
    }
    return PolicyService.instance;
  }

  init({ userSettingsService, commandRegistry } = {}) {
    this.userSettingsService = userSettingsService || this.userSettingsService;
    this.commandRegistry = commandRegistry || this.commandRegistry;
  }

  getDefaultConfig() {
    return {
      enabled: false,
      defaultRole: 'admin',
      allowHeaderOverride: false,
      headerName: 'x-orchestrator-role',
      allowQueryOverride: false,
      queryName: 'role',
      roleByAction: {
        read: 'viewer',
        write: 'operator',
        destructive: 'admin',
        billing: 'admin',
        audit_export: 'operator',
        command_execute: 'operator'
      },
      dangerousCommandPatterns: [
        'merge',
        'approve',
        'request-changes',
        'request_changes',
        'remove',
        'destroy',
        'kill',
        'stop',
        'restart',
        'close',
        'ticket-move'
      ],
      readOnlyCommandPatterns: [
        'list-',
        'get-',
        'open-',
        'show-',
        'status',
        'catalog',
        'capabilities',
        'context'
      ]
    };
  }

  getConfig() {
    const defaults = this.getDefaultConfig();
    const fromSettings = this.userSettingsService?.getAllSettings?.()?.global?.policy || {};
    return {
      ...defaults,
      ...(fromSettings && typeof fromSettings === 'object' ? fromSettings : {}),
      roleByAction: {
        ...defaults.roleByAction,
        ...((fromSettings && fromSettings.roleByAction && typeof fromSettings.roleByAction === 'object')
          ? fromSettings.roleByAction
          : {})
      }
    };
  }

  normalizeRole(rawRole) {
    const role = String(rawRole || '').trim().toLowerCase();
    if (role === 'viewer' || role === 'operator' || role === 'admin' || role === 'system') return role;
    return 'viewer';
  }

  roleRank(role) {
    const normalized = this.normalizeRole(role);
    if (normalized === 'system') return 4;
    if (normalized === 'admin') return 3;
    if (normalized === 'operator') return 2;
    return 1;
  }

  roleSatisfies(role, requiredRole) {
    return this.roleRank(role) >= this.roleRank(requiredRole);
  }

  resolveRole(req, opts = {}) {
    const cfg = this.getConfig();
    const fallbackRole = this.normalizeRole(opts.fallbackRole || cfg.defaultRole || 'admin');
    if (cfg.enabled !== true) {
      return { role: 'admin', source: 'policy_disabled' };
    }

    let role = fallbackRole;
    let source = 'default';

    if (cfg.allowHeaderOverride === true && req?.headers) {
      const headerName = String(cfg.headerName || 'x-orchestrator-role').trim().toLowerCase();
      const headerRaw = req.headers[headerName];
      if (headerRaw !== undefined && String(headerRaw).trim() !== '') {
        const headerRole = this.normalizeRole(headerRaw);
        role = headerRole;
        source = 'header';
      }
    }

    if (cfg.allowQueryOverride === true && req?.query) {
      const queryName = String(cfg.queryName || 'role').trim();
      const queryRaw = req.query[queryName];
      if (queryRaw !== undefined && String(queryRaw).trim() !== '') {
        const queryRole = this.normalizeRole(queryRaw);
        role = queryRole;
        source = 'query';
      }
    }

    return { role, source };
  }

  requiredRoleForAction(action, cfg = this.getConfig()) {
    const key = String(action || '').trim().toLowerCase();
    const map = cfg?.roleByAction || {};
    return this.normalizeRole(map[key] || 'viewer');
  }

  canAccessAction({ req, action, role } = {}) {
    const cfg = this.getConfig();
    if (cfg.enabled !== true) {
      return { ok: true, role: 'admin', requiredRole: 'viewer', policyEnabled: false };
    }

    const resolved = role ? { role: this.normalizeRole(role), source: 'explicit' } : this.resolveRole(req);
    const requiredRole = this.requiredRoleForAction(action, cfg);
    const ok = this.roleSatisfies(resolved.role, requiredRole);
    return {
      ok,
      policyEnabled: true,
      role: resolved.role,
      roleSource: resolved.source,
      requiredRole,
      action: String(action || '').trim().toLowerCase(),
      reason: ok ? null : `Role "${resolved.role}" cannot perform action "${action}" (requires "${requiredRole}")`
    };
  }

  inferRequiredRoleForCommand(commandName, commandMeta, cfg = this.getConfig()) {
    const explicitRaw = String(commandMeta?.requiredRole || '').trim();
    if (explicitRaw) return this.normalizeRole(explicitRaw);

    const safetyLevel = String(commandMeta?.safetyLevel || '').trim().toLowerCase();
    if (safetyLevel === 'dangerous') return 'admin';
    if (safetyLevel === 'caution') return 'operator';

    const lowerName = String(commandName || '').trim().toLowerCase();
    const dangerousPatterns = Array.isArray(cfg?.dangerousCommandPatterns) ? cfg.dangerousCommandPatterns : [];
    if (dangerousPatterns.some((pattern) => lowerName.includes(String(pattern || '').trim().toLowerCase()))) {
      return 'admin';
    }

    const readPatterns = Array.isArray(cfg?.readOnlyCommandPatterns) ? cfg.readOnlyCommandPatterns : [];
    if (readPatterns.some((pattern) => {
      const p = String(pattern || '').trim().toLowerCase();
      if (!p) return false;
      if (p.endsWith('-')) return lowerName.startsWith(p);
      return lowerName.includes(p);
    })) {
      return 'viewer';
    }

    return 'operator';
  }

  authorizeCommand({ req, commandName, role } = {}) {
    const cfg = this.getConfig();
    const base = this.canAccessAction({ req, action: 'command_execute', role });
    if (!base.ok) return base;
    if (cfg.enabled !== true) return base;

    const cmdMeta = this.commandRegistry?.getCommand?.(commandName) || null;
    if (!cmdMeta) {
      return {
        ...base,
        ok: false,
        reason: `Unknown command: ${String(commandName || '').trim() || '(empty)'}`
      };
    }

    const requiredRole = this.inferRequiredRoleForCommand(commandName, cmdMeta, cfg);
    const ok = this.roleSatisfies(base.role, requiredRole);
    return {
      ...base,
      command: String(commandName || '').trim(),
      requiredRole,
      ok,
      reason: ok ? null : `Role "${base.role}" cannot run command "${commandName}" (requires "${requiredRole}")`
    };
  }

  getStatus({ req } = {}) {
    const cfg = this.getConfig();
    const resolved = this.resolveRole(req);
    return {
      ok: true,
      enabled: cfg.enabled === true,
      resolvedRole: resolved.role,
      resolvedRoleSource: resolved.source,
      config: cfg
    };
  }
}

module.exports = { PolicyService };
