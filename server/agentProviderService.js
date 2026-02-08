class AgentProviderService {
  constructor(options = {}) {
    this.agentManager = options.agentManager || null;
    this.logger = options.logger || null;
    this.providers = new Map();
    this.initializeBuiltins();
  }

  static getInstance(options = {}) {
    if (!AgentProviderService.instance) {
      AgentProviderService.instance = new AgentProviderService(options);
    } else {
      if (options.agentManager) AgentProviderService.instance.agentManager = options.agentManager;
      if (options.logger) AgentProviderService.instance.logger = options.logger;
    }
    return AgentProviderService.instance;
  }

  initializeBuiltins() {
    this.registerProvider({
      id: 'claude',
      name: 'Claude',
      sessionType: 'claude',
      historySource: 'claude',
      capabilities: {
        listSessions: true,
        resume: true,
        searchHistory: true,
        getTranscript: true
      }
    });

    this.registerProvider({
      id: 'codex',
      name: 'Codex',
      sessionType: 'codex',
      historySource: 'codex',
      capabilities: {
        listSessions: true,
        resume: true,
        searchHistory: true,
        getTranscript: true
      }
    });
  }

  normalizeProvider(input = {}) {
    const id = String(input.id || '').trim().toLowerCase();
    if (!id) throw new Error('provider id is required');

    const caps = input.capabilities && typeof input.capabilities === 'object'
      ? input.capabilities
      : {};

    const capabilities = {
      listSessions: caps.listSessions !== false,
      resume: caps.resume !== false,
      searchHistory: caps.searchHistory !== false,
      getTranscript: caps.getTranscript !== false
    };

    return {
      id,
      name: String(input.name || id).trim() || id,
      sessionType: String(input.sessionType || id).trim().toLowerCase() || id,
      historySource: String(input.historySource || id).trim().toLowerCase() || id,
      capabilities,
      metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
      handlers: {
        listSessions: typeof input.listSessions === 'function' ? input.listSessions : null,
        resume: typeof input.resume === 'function' ? input.resume : null,
        searchHistory: typeof input.searchHistory === 'function' ? input.searchHistory : null,
        getTranscript: typeof input.getTranscript === 'function' ? input.getTranscript : null
      }
    };
  }

  registerProvider(input = {}) {
    const provider = this.normalizeProvider(input);
    this.providers.set(provider.id, provider);
    return provider;
  }

  listProviders() {
    return Array.from(this.providers.values())
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        sessionType: provider.sessionType,
        historySource: provider.historySource,
        capabilities: { ...provider.capabilities },
        metadata: { ...provider.metadata }
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  getProvider(providerId) {
    const id = String(providerId || '').trim().toLowerCase();
    const provider = this.providers.get(id);
    if (!provider) {
      const error = new Error(`Unknown provider: ${providerId}`);
      error.code = 'UNKNOWN_PROVIDER';
      throw error;
    }
    return provider;
  }

  listSessions(providerId, context = {}) {
    const provider = this.getProvider(providerId);
    if (!provider.capabilities.listSessions) return [];

    if (provider.handlers.listSessions) {
      return provider.handlers.listSessions({ provider, ...context }) || [];
    }

    const sessionManager = context.sessionManager || null;
    if (!sessionManager || typeof sessionManager.getSessionStates !== 'function') return [];
    const states = sessionManager.getSessionStates() || {};

    return Object.entries(states)
      .filter(([, state]) => {
        const type = String(state?.type || '').trim().toLowerCase();
        const agent = String(state?.agent || '').trim().toLowerCase();
        return type === provider.sessionType || agent === provider.id;
      })
      .map(([sessionId, state]) => ({ sessionId, ...(state || {}) }));
  }

  buildResumePlan(providerId, params = {}, context = {}) {
    const provider = this.getProvider(providerId);
    if (!provider.capabilities.resume) {
      const error = new Error(`Provider does not support resume: ${provider.id}`);
      error.code = 'UNSUPPORTED_OPERATION';
      throw error;
    }

    if (provider.handlers.resume) {
      return provider.handlers.resume({ provider, params, ...context }) || null;
    }

    const resumeId = String(params.resumeId || params.conversationId || params.id || '').trim();
    const sessionId = String(params.sessionId || '').trim();
    const hasResumeId = !!resumeId;
    const hasSessionId = !!sessionId;
    const plan = {
      provider: provider.id,
      sessionId: hasSessionId ? sessionId : null,
      resumeId: hasResumeId ? resumeId : null,
      executeReady: hasSessionId && hasResumeId,
      command: null,
      mode: 'resume',
      config: null
    };

    const baseConfig = this.agentManager?.getPowerfulConfig?.(provider.id) || this.agentManager?.getDefaultConfig?.(provider.id) || {
      agentId: provider.id,
      mode: 'resume',
      flags: []
    };

    plan.config = {
      ...baseConfig,
      agentId: provider.id,
      mode: 'resume',
      resumeId: plan.resumeId || undefined
    };

    if (this.agentManager && typeof this.agentManager.buildCommand === 'function') {
      try {
        plan.command = this.agentManager.buildCommand(provider.id, 'resume', plan.config);
      } catch (error) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn('Failed to build provider resume command', {
            provider: provider.id,
            error: error.message
          });
        }
      }
    }

    return plan;
  }

  async searchHistory(providerId, params = {}, context = {}) {
    const provider = this.getProvider(providerId);
    if (!provider.capabilities.searchHistory) {
      const error = new Error(`Provider does not support history search: ${provider.id}`);
      error.code = 'UNSUPPORTED_OPERATION';
      throw error;
    }

    if (provider.handlers.searchHistory) {
      return await provider.handlers.searchHistory({ provider, params, ...context });
    }

    const conversationService = context.conversationService || null;
    if (!conversationService || typeof conversationService.search !== 'function') {
      throw new Error('conversationService is required for history search');
    }

    const query = String(params.query || params.q || '').trim();
    const project = String(params.project || '').trim() || undefined;
    const branch = String(params.branch || '').trim() || undefined;
    const folder = String(params.folder || '').trim() || undefined;
    const startDate = String(params.startDate || '').trim() || undefined;
    const endDate = String(params.endDate || '').trim() || undefined;
    const limitRaw = Number(params.limit);
    const offsetRaw = Number(params.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.round(limitRaw))) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.round(offsetRaw)) : 0;

    return await conversationService.search(query, {
      source: provider.historySource,
      project,
      branch,
      folder,
      startDate,
      endDate,
      limit,
      offset
    });
  }

  async getTranscript(providerId, params = {}, context = {}) {
    const provider = this.getProvider(providerId);
    if (!provider.capabilities.getTranscript) {
      const error = new Error(`Provider does not support transcript retrieval: ${provider.id}`);
      error.code = 'UNSUPPORTED_OPERATION';
      throw error;
    }

    if (provider.handlers.getTranscript) {
      return await provider.handlers.getTranscript({ provider, params, ...context });
    }

    const conversationService = context.conversationService || null;
    if (!conversationService || typeof conversationService.getConversation !== 'function') {
      throw new Error('conversationService is required for transcript retrieval');
    }

    const id = String(params.id || params.conversationId || '').trim();
    if (!id) {
      const error = new Error('conversation id is required');
      error.code = 'INVALID_INPUT';
      throw error;
    }
    const project = String(params.project || '').trim() || undefined;
    return await conversationService.getConversation(id, {
      source: provider.historySource,
      project
    });
  }
}

module.exports = { AgentProviderService };
