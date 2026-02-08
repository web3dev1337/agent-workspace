const { AgentProviderService } = require('../../server/agentProviderService');

describe('AgentProviderService', () => {
  beforeEach(() => {
    AgentProviderService.instance = null;
  });

  test('lists built-in providers', () => {
    const service = new AgentProviderService();
    const providers = service.listProviders();
    const ids = providers.map((provider) => provider.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
  });

  test('throws unknown provider error code', () => {
    const service = new AgentProviderService();
    expect(() => service.getProvider('nope')).toThrow('Unknown provider');
    try {
      service.getProvider('nope');
    } catch (error) {
      expect(error.code).toBe('UNKNOWN_PROVIDER');
    }
  });

  test('lists sessions by provider sessionType or agent', () => {
    const service = new AgentProviderService();
    const sessions = service.listSessions('codex', {
      sessionManager: {
        getSessionStates: () => ({
          'a-codex': { type: 'codex', branch: 'feature/a' },
          'b-claude': { type: 'claude', branch: 'feature/b' },
          'c-codex-agent': { type: 'shell', agent: 'codex', branch: 'feature/c' }
        })
      }
    });
    const ids = sessions.map((session) => session.sessionId);
    expect(ids).toEqual(expect.arrayContaining(['a-codex', 'c-codex-agent']));
    expect(ids).not.toContain('b-claude');
  });

  test('builds resume plan and command with agent manager', () => {
    const buildCommand = jest.fn(() => 'codex resume abc123');
    const service = new AgentProviderService({
      agentManager: {
        getPowerfulConfig: () => ({ agentId: 'codex', mode: 'resume', flags: ['--danger'] }),
        buildCommand
      }
    });
    const plan = service.buildResumePlan('codex', {
      sessionId: 'zoo-game-work1-codex',
      resumeId: 'abc123'
    });
    expect(plan.provider).toBe('codex');
    expect(plan.executeReady).toBe(true);
    expect(plan.command).toBe('codex resume abc123');
    expect(plan.config.resumeId).toBe('abc123');
    expect(buildCommand).toHaveBeenCalledWith('codex', 'resume', expect.any(Object));
  });

  test('searches history with normalized inputs', async () => {
    const search = jest.fn(async () => ({ items: [{ id: 'one' }], total: 1 }));
    const service = new AgentProviderService();
    const result = await service.searchHistory('claude', {
      q: 'conflict',
      project: 'zoo-game',
      limit: '25',
      offset: '2'
    }, {
      conversationService: { search }
    });
    expect(result.total).toBe(1);
    expect(search).toHaveBeenCalledWith('conflict', expect.objectContaining({
      source: 'claude',
      project: 'zoo-game',
      limit: 25,
      offset: 2
    }));
  });

  test('gets transcript with provider source', async () => {
    const getConversation = jest.fn(async () => ({ id: 'conv-1', source: 'codex' }));
    const service = new AgentProviderService();
    const transcript = await service.getTranscript('codex', { id: 'conv-1', project: 'zoo-game' }, {
      conversationService: { getConversation }
    });
    expect(transcript.id).toBe('conv-1');
    expect(getConversation).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      source: 'codex',
      project: 'zoo-game'
    }));
  });

  test('supports custom provider handlers', async () => {
    const service = new AgentProviderService();
    service.registerProvider({
      id: 'opencode',
      name: 'OpenCode',
      sessionType: 'opencode',
      historySource: 'opencode',
      listSessions: () => [{ sessionId: 'opencode-work1', type: 'opencode' }],
      resume: ({ params }) => ({ provider: 'opencode', resumeId: params.resumeId, executeReady: true }),
      searchHistory: async () => ({ items: [{ id: 'open-1' }], total: 1 }),
      getTranscript: async () => ({ id: 'open-1', source: 'opencode' })
    });

    const sessions = service.listSessions('opencode');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('opencode-work1');

    const plan = service.buildResumePlan('opencode', { resumeId: 'resume-open-1' });
    expect(plan.provider).toBe('opencode');
    expect(plan.executeReady).toBe(true);

    const history = await service.searchHistory('opencode', { q: 'test' });
    expect(history.total).toBe(1);

    const transcript = await service.getTranscript('opencode', { id: 'open-1' });
    expect(transcript.source).toBe('opencode');
  });
});
