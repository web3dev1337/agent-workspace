const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/batch-launch.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const AGENT_INIT_DELAY = { claude: 8000, codex: 15000 };

class BatchLaunchService {
  constructor(deps) {
    this.taskTicketingService = deps.taskTicketingService;
    this.workspaceManager = deps.workspaceManager;
    this.sessionManager = deps.sessionManager;
    this.taskRecordService = deps.taskRecordService;
    this.userSettingsService = deps.userSettingsService;
    this.ensureWorkspaceMixedWorktree = deps.ensureWorkspaceMixedWorktree;
    this.io = deps.io;
  }

  static getInstance(deps) {
    if (!BatchLaunchService._instance) {
      BatchLaunchService._instance = new BatchLaunchService(deps);
    }
    return BatchLaunchService._instance;
  }

  async batchLaunch(params = {}) {
    const {
      provider: providerName = 'trello',
      boardId,
      listId,
      cardIds = null,
      limit = null,
      agentOverride = null,
      tierOverride = null,
      moveToListId = null,
      workspaceId = null,
      dryRun = false
    } = params;

    if (!boardId) throw new Error('boardId is required');
    if (!listId && !cardIds) throw new Error('listId or cardIds is required');

    const provider = this.taskTicketingService.getProvider(providerName);

    // Resolve cards
    let cards;
    if (cardIds && cardIds.length > 0) {
      cards = await Promise.all(cardIds.map(id => provider.getCard({ cardId: id })));
    } else {
      const listCards = await provider.listCards({ listId, refresh: true });
      const sliced = limit ? listCards.slice(0, limit) : listCards;
      cards = await Promise.all(sliced.map(c => provider.getCard({ cardId: c.id || c.shortLink, refresh: true })));
    }

    if (!cards.length) return { success: true, launched: [], failed: [], summary: { total: 0, launched: 0, failed: 0 } };

    // Resolve workspace
    const resolvedWorkspaceId = workspaceId || this._getActiveWorkspaceId();
    if (!resolvedWorkspaceId) throw new Error('No active workspace. Pass workspaceId or switch to a workspace in the UI.');

    // Resolve board mapping for repo info
    const mapping = this._getBoardMapping(providerName, boardId);
    if (!mapping || !mapping.localPath) throw new Error(`No board mapping for ${providerName}:${boardId}. Configure it in Settings > Tasks.`);

    const repoPath = this._resolveRepoPath(mapping.localPath);
    const repoName = path.basename(String(repoPath || '').replace(/[\\/]+$/, ''));
    const repoType = mapping.repositoryType || 'hytopia-game';
    const defaultTier = tierOverride || mapping.defaultStartTier || 3;
    const startingWorktreeNumber = this._getNextWorktreeNumber({
      workspaceId: resolvedWorkspaceId,
      repoPath,
      repoName
    });

    // Fetch custom fields for agent detection
    let customFieldDefs = [];
    if (!agentOverride) {
      try { customFieldDefs = await provider.listBoardCustomFields({ boardId }); } catch (_) {}
    }

    // Prompt prefixes
    const settings = this.userSettingsService.getAllSettings();
    const globalPromptPrefix = settings?.global?.ui?.tasks?.launch?.globalPromptPrefix || '';
    const boardPromptPrefix = mapping.promptPrefix || '';

    if (dryRun) {
      return this._buildDryRunResponse(cards, {
        agentOverride,
        customFieldDefs,
        defaultTier,
        repoName,
        resolvedWorkspaceId,
        startingWorktreeNumber
      });
    }

    // Sequential launch
    const launched = [];
    const failed = [];

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const worktreeId = `work${startingWorktreeNumber + i}`;
      try {
        const result = await this._launchSingleCard({
          card, provider, boardId, resolvedWorkspaceId,
          repoPath, repoName, repoType, defaultTier,
          agentOverride, customFieldDefs,
          globalPromptPrefix, boardPromptPrefix,
          moveToListId, worktreeId
        });
        launched.push(result);
      } catch (err) {
        logger.error('Failed to launch card', { cardId: card.id, cardName: card.name, worktreeId, error: err.message });
        failed.push({ cardId: card.id, cardName: card.name, worktreeId, error: err.message, phase: err.phase || 'unknown' });
      }
    }

    return {
      success: true,
      launched,
      failed,
      summary: { total: cards.length, launched: launched.length, failed: failed.length }
    };
  }

  async _launchSingleCard({
    card, provider, boardId, resolvedWorkspaceId,
    repoPath, repoName, repoType, defaultTier,
    agentOverride, customFieldDefs,
    globalPromptPrefix, boardPromptPrefix,
    moveToListId, worktreeId: requestedWorktreeId
  }) {
    const agentId = agentOverride || this._detectAgentFromCard(card, customFieldDefs);
    const tier = defaultTier;
    const cardUrl = card.url || card.shortUrl || '';
    const cardShortId = card.shortLink || card.id;

    // 1. Create worktree
    let worktreeResult;
    try {
      worktreeResult = await this.ensureWorkspaceMixedWorktree({
        workspaceId: resolvedWorkspaceId,
        repositoryPath: repoPath,
        repositoryType: repoType,
        repositoryName: repoName,
        worktreeId: requestedWorktreeId,
        startTier: tier
      });
    } catch (err) {
      const e = new Error(`Worktree allocation failed: ${err.message}`);
      e.phase = 'worktree-allocation';
      throw e;
    }

    const { worktreeId } = worktreeResult;
    const claudeSessionId = `${repoName}-${worktreeId}-claude`;

    // 2. Build prompt
    const prompt = this._buildPrompt({ card, cardUrl, cardShortId, globalPromptPrefix, boardPromptPrefix });

    // 3. Link task record (non-blocking)
    this.taskRecordService.upsert(`session:${claudeSessionId}`, {
      tier,
      ticketProvider: 'trello',
      ticketCardId: cardShortId,
      ticketBoardId: boardId,
      ticketCardUrl: cardUrl,
      ticketTitle: card.name
    }).catch(err => logger.warn('Failed to link task record', { sessionId: claudeSessionId, error: err.message }));

    // 4. Start agent
    const flags = (agentId === 'claude') ? ['skipPermissions'] : [];
    const agentStarted = this.sessionManager.startAgentWithConfig(claudeSessionId, {
      agentId,
      mode: 'fresh',
      flags
    });

    if (!agentStarted) {
      const e = new Error('Failed to start agent in session');
      e.phase = 'agent-start';
      throw e;
    }

    // 5. Wait for agent init, then send prompt
    const delay = AGENT_INIT_DELAY[agentId] || AGENT_INIT_DELAY.claude;
    await new Promise(resolve => setTimeout(resolve, delay));

    this.sessionManager.writeToSession(claudeSessionId, prompt);
    await new Promise(resolve => setTimeout(resolve, 500));
    this.sessionManager.writeToSession(claudeSessionId, '\r');

    // 6. Move card (non-blocking)
    if (moveToListId) {
      provider.updateCard({ cardId: card.id, fields: { idList: moveToListId } })
        .catch(err => logger.warn('Failed to move card', { cardId: card.id, error: err.message }));
    }

    logger.info('Card launched', { cardName: card.name, worktreeId, sessionId: claudeSessionId, agent: agentId, tier });

    return {
      cardId: card.id,
      cardName: card.name,
      worktreeId,
      sessionId: claudeSessionId,
      agent: agentId,
      tier
    };
  }

  _buildPrompt({ card, cardUrl, cardShortId, globalPromptPrefix, boardPromptPrefix }) {
    const preface = [
      'Task context: this work is for a ticket.',
      card.name ? `Ticket title: ${card.name}` : '',
      cardUrl ? `Trello card: ${cardUrl}` : '',
      cardShortId ? `Ticket id: trello:${cardShortId}` : '',
      '',
      'When you create/update a PR, include the Trello card URL in the PR description so automation can move the ticket on merge.',
      ''
    ].filter(Boolean).join('\n');

    return [
      globalPromptPrefix || '',
      boardPromptPrefix || '',
      preface || '',
      (card.desc || '').trim() || ''
    ].map(s => String(s || '').replace(/\s+$/, '')).filter(Boolean).join('\n\n').trim();
  }

  _detectAgentFromCard(card, customFieldDefs) {
    if (!Array.isArray(card.customFieldItems) || !card.customFieldItems.length) return 'claude';
    if (!Array.isArray(customFieldDefs) || !customFieldDefs.length) return 'claude';

    const agentField = customFieldDefs.find(f => /agent/i.test(f.name));
    if (!agentField) return 'claude';

    const cardFieldItem = card.customFieldItems.find(i => i.idCustomField === agentField.id);
    if (!cardFieldItem || !cardFieldItem.idValue) return 'claude';

    const selectedOption = (agentField.options || []).find(o => o.id === cardFieldItem.idValue);
    if (!selectedOption) return 'claude';

    const optionText = (selectedOption.value?.text || '').toLowerCase();
    if (optionText.includes('codex')) return 'codex';
    return 'claude';
  }

  _getActiveWorkspaceId() {
    const active = this.workspaceManager.getActiveWorkspace();
    if (active) return active.id;
    const configActive = this.workspaceManager.getConfig()?.activeWorkspace;
    return configActive || null;
  }

  _getBoardMapping(providerName, boardId) {
    const settings = this.userSettingsService.getAllSettings();
    const mappings = settings?.global?.ui?.tasks?.boardMappings || {};
    return mappings[`${providerName}:${boardId}`] || null;
  }

  _resolveRepoPath(localPath) {
    if (localPath.startsWith('/')) return localPath;
    const home = require('os').homedir();
    return require('path').join(home, 'GitHub', localPath);
  }

  _normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  }

  _getNextWorktreeNumber({ workspaceId, repoPath, repoName } = {}) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    const terminals = Array.isArray(workspace?.terminals) ? workspace.terminals : [];
    const targetPath = this._normalizePath(repoPath);
    const targetName = String(repoName || '').trim().toLowerCase();
    let max = 0;

    for (const terminal of terminals) {
      const terminalPath = this._normalizePath(terminal?.repository?.path);
      const terminalName = String(terminal?.repository?.name || '').trim().toLowerCase();
      const sameRepo = (targetPath && terminalPath && targetPath === terminalPath)
        || (!targetPath && targetName && targetName === terminalName);
      if (!sameRepo) continue;

      const id = String(terminal?.worktree || terminal?.worktreeId || '').trim().toLowerCase();
      const match = id.match(/^work(\d+)$/);
      if (!match) continue;
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }

    return Math.max(1, max + 1);
  }

  _buildDryRunResponse(cards, { agentOverride, customFieldDefs, defaultTier, repoName, resolvedWorkspaceId, startingWorktreeNumber = 1 }) {
    const preview = cards.map((card, i) => ({
      cardId: card.id,
      cardName: card.name,
      agent: agentOverride || this._detectAgentFromCard(card, customFieldDefs),
      tier: defaultTier,
      wouldCreateWorktree: `work${startingWorktreeNumber + i}`,
      wouldCreateSession: `${repoName}-work${startingWorktreeNumber + i}-claude`,
      workspaceId: resolvedWorkspaceId
    }));
    return { success: true, dryRun: true, preview, summary: { total: cards.length } };
  }
}

module.exports = { BatchLaunchService };
