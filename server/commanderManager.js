'use strict';

// CommanderManager — holds one or more Commander instances keyed by id.
// The primary instance keeps id 'commander' so all existing single-Commander
// behavior (routes with no id → 'commander') is unchanged. Additional
// commanders let the user run a second independent orchestrating AI terminal.

const path = require('path');
const { CommanderService } = require('./commanderService');
const { getAgentWorkspaceDir } = require('./utils/pathUtils');

const PRIMARY_ID = 'commander';
const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_COMMANDERS = 6;

class CommanderManager {
  constructor(options = {}) {
    this.io = options.io;
    this.sessionManager = options.sessionManager;
    this.instances = new Map();
    // Eagerly create the primary so getInstance()-era callers keep working.
    this.instances.set(PRIMARY_ID, new CommanderService({
      io: this.io,
      sessionManager: this.sessionManager,
      id: PRIMARY_ID
    }));
  }

  static getInstance(options = {}) {
    if (!CommanderManager.instance) {
      CommanderManager.instance = new CommanderManager(options);
    }
    return CommanderManager.instance;
  }

  primary() {
    return this.instances.get(PRIMARY_ID);
  }

  // Resolve an instance by id, defaulting to the primary. Never auto-creates
  // arbitrary ids from request input — unknown ids fall back to primary so a
  // stray/legacy client can't spawn ghost commanders. Explicit creation goes
  // through spawn().
  resolve(id) {
    const key = String(id || '').trim();
    if (!key || key === PRIMARY_ID) return this.primary();
    return this.instances.get(key) || this.primary();
  }

  has(id) {
    return this.instances.has(String(id || '').trim());
  }

  // Per-instance working directory: the primary uses the service default;
  // additional commanders get their own dir under the app data folder so they
  // can carry a distinct CLAUDE.md persona without colliding.
  cwdForId(id) {
    if (id === PRIMARY_ID) return undefined;
    try {
      return path.join(getAgentWorkspaceDir(), 'commanders', id);
    } catch {
      return undefined;
    }
  }

  spawn(rawId) {
    const id = String(rawId || '').trim().toLowerCase();
    if (!CUSTOM_ID_RE.test(id)) {
      throw new Error('Invalid commander id (lowercase letters/digits/dashes, max 32 chars)');
    }
    if (id === PRIMARY_ID) {
      throw new Error(`'${PRIMARY_ID}' is the primary commander and always exists`);
    }
    if (this.instances.has(id)) return this.instances.get(id);
    if (this.instances.size >= MAX_COMMANDERS) {
      throw new Error(`Commander limit reached (${MAX_COMMANDERS})`);
    }

    const instance = new CommanderService({
      io: this.io,
      sessionManager: this.sessionManager,
      id,
      cwd: this.cwdForId(id)
    });
    this.instances.set(id, instance);
    return instance;
  }

  async remove(rawId) {
    const id = String(rawId || '').trim();
    if (id === PRIMARY_ID) {
      throw new Error('The primary commander cannot be removed');
    }
    const instance = this.instances.get(id);
    if (!instance) return { removed: false };
    try {
      instance.stop();
    } catch {
      // best-effort teardown
    }
    this.instances.delete(id);
    return { removed: true };
  }

  list() {
    return Array.from(this.instances.entries()).map(([id, instance]) => {
      let status = null;
      try {
        status = instance.getStatus ? instance.getStatus() : null;
      } catch {
        status = null;
      }
      return {
        id,
        primary: id === PRIMARY_ID,
        running: !!instance.session,
        ready: !!instance.isReady,
        claudeStarted: !!instance.claudeStarted,
        status
      };
    });
  }
}

module.exports = { CommanderManager, PRIMARY_ID, MAX_COMMANDERS };
