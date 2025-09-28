/**
 * Agent Modal Manager - Dynamic UI for multi-agent selection
 * Automatically generates interface based on server agent configurations
 */

class AgentModalManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.agentConfigs = null;
    this.selectedAgent = null;
    this.selectedMode = null;
    this.selectedFlags = [];
    this.currentSessionId = null;

    this.init();
  }

  init() {
    this.bindEvents();
  }

  bindEvents() {
    // Agent selection
    document.addEventListener('change', (e) => {
      if (e.target.name === 'agent-selection') {
        this.selectAgent(e.target.value);
      }
    });

    // Mode selection
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('mode-btn')) {
        this.selectMode(e.target.dataset.mode);
      }
    });

    // Flag selection
    document.addEventListener('change', (e) => {
      if (e.target.classList.contains('flag-checkbox') || e.target.classList.contains('flag-radio')) {
        this.updateFlags();
      }
    });

    // Preset buttons
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-btn')) {
        this.applyPreset(e.target.dataset.preset);
      }
    });

    // Start button
    document.getElementById('start-agent')?.addEventListener('click', () => {
      this.startAgent();
    });

    // Cancel button
    document.getElementById('cancel-agent-startup')?.addEventListener('click', () => {
      this.hideModal();
    });
  }

  async loadAgentConfigurations() {
    try {
      const response = await fetch('/api/agents');
      if (!response.ok) throw new Error('Failed to load agent configurations');

      this.agentConfigs = await response.json();
      console.log('Loaded agent configurations:', this.agentConfigs);
    } catch (error) {
      console.error('Failed to load agent configurations:', error);
      // Fallback to hardcoded configs for development
      this.agentConfigs = [
        {
          id: 'claude',
          name: 'Claude',
          icon: '🤖',
          description: 'Anthropic Claude Code',
          modes: [
            { id: 'fresh', name: 'Fresh', description: 'Start new session' },
            { id: 'continue', name: 'Continue', description: 'Resume conversation' },
            { id: 'resume', name: 'Resume', description: 'Restore interrupted session' }
          ],
          flags: [
            {
              id: 'skipPermissions',
              label: '🚀 YOLO Mode',
              description: 'YOLO Mode (skip permissions)',
              category: 'permissions'
            }
          ],
          defaultMode: 'fresh'
        },
        {
          id: 'codex',
          name: 'Codex',
          icon: '⚡',
          description: 'OpenAI Codex',
          modes: [
            { id: 'search', name: 'Search', description: 'Search and analyze mode' },
            { id: 'create', name: 'Create', description: 'Create new content' },
            { id: 'analyze', name: 'Analyze', description: 'Analyze existing code' }
          ],
          flags: [
            {
              id: 'gpt5Model',
              label: '🔥 GPT-5 Model',
              description: 'Use GPT-5 Codex model',
              category: 'model'
            },
            {
              id: 'highReasoning',
              label: '🧠 High Reasoning',
              description: 'High reasoning effort',
              category: 'reasoning'
            },
            {
              id: 'workspaceWrite',
              label: '📝 Workspace + Network',
              description: 'Workspace write with network access',
              category: 'sandbox'
            },
            {
              id: 'bypassAll',
              label: '🚀 Full Bypass',
              description: 'Bypass all safety (maximum power)',
              category: 'sandbox'
            }
          ],
          defaultMode: 'search'
        }
      ];
    }
  }

  async showModal(sessionId) {
    this.currentSessionId = sessionId;

    // Load agent configurations if not already loaded
    if (!this.agentConfigs) {
      await this.loadAgentConfigurations();
    }

    // Update session ID display
    const sessionInfo = document.getElementById('startup-session-id');
    if (sessionInfo) {
      const worktreeNumber = sessionId.replace('work', '').replace('-claude', '');
      sessionInfo.textContent = `Work ${worktreeNumber}`;
    }

    // Render agent options
    this.renderAgentOptions();

    // Select default agent (Claude)
    this.selectAgent('claude');

    // Show modal
    const modal = document.getElementById('agent-startup-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  hideModal() {
    const modal = document.getElementById('agent-startup-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    this.currentSessionId = null;
  }

  renderAgentOptions() {
    const container = document.getElementById('agent-options');
    if (!container || !this.agentConfigs) return;

    container.innerHTML = this.agentConfigs.map(agent => `
      <label class="agent-option" for="agent-${agent.id}">
        <input type="radio"
               name="agent-selection"
               value="${agent.id}"
               id="agent-${agent.id}"
               style="display: none;">
        <div class="agent-icon">${agent.icon}</div>
        <div class="agent-name">${agent.name}</div>
        <div class="agent-desc">${agent.description}</div>
      </label>
    `).join('');
  }

  selectAgent(agentId) {
    if (!this.agentConfigs) return;

    const agent = this.agentConfigs.find(a => a.id === agentId);
    if (!agent) return;

    this.selectedAgent = agentId;

    // Update visual selection
    document.querySelectorAll('.agent-option').forEach(el => {
      el.classList.remove('selected');
    });
    document.querySelector(`label[for="agent-${agentId}"]`)?.classList.add('selected');

    // Check the radio button
    const radio = document.getElementById(`agent-${agentId}`);
    if (radio) radio.checked = true;

    // Render modes and flags for this agent
    this.renderModes(agent);
    this.renderFlags(agent);

    // Select default mode
    this.selectMode(agent.defaultMode);
  }

  renderModes(agent) {
    const container = document.getElementById('mode-buttons');
    if (!container) return;

    container.innerHTML = agent.modes.map(mode => `
      <button class="mode-btn"
              data-mode="${mode.id}"
              title="${mode.description}">
        ${mode.name}
      </button>
    `).join('');
  }

  selectMode(modeId) {
    this.selectedMode = modeId;

    // Update visual selection
    document.querySelectorAll('.mode-btn').forEach(el => {
      el.classList.remove('selected');
    });
    document.querySelector(`[data-mode="${modeId}"]`)?.classList.add('selected');
  }

  renderFlags(agent) {
    const container = document.getElementById('flag-configuration');
    if (!container || !agent.flags) return;

    // Group flags by category
    const categories = {};
    agent.flags.forEach(flag => {
      const category = flag.category || 'general';
      if (!categories[category]) categories[category] = [];
      categories[category].push(flag);
    });

    container.innerHTML = Object.entries(categories).map(([categoryName, flags]) => {
      const isExclusive = this.isCategoryExclusive(agent, categoryName);
      const inputType = isExclusive ? 'radio' : 'checkbox';
      const inputClass = isExclusive ? 'flag-radio' : 'flag-checkbox';

      return `
        <div class="flag-category">
          <div class="flag-category-title">${this.formatCategoryName(categoryName)}</div>
          <div class="flag-options">
            ${flags.map(flag => `
              <label class="flag-option" for="flag-${flag.id}">
                <input type="${inputType}"
                       name="${isExclusive ? `flag-${categoryName}` : `flag-${flag.id}`}"
                       value="${flag.id}"
                       id="flag-${flag.id}"
                       class="${inputClass}"
                       ${flag.default ? 'checked' : ''}>
                <div>
                  <div class="flag-label">${flag.label}</div>
                  <div class="flag-desc">${flag.description}</div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Initialize selected flags
    this.updateFlags();
  }

  isCategoryExclusive(agent, categoryName) {
    // For now, assume model and reasoning categories are exclusive
    return ['model', 'reasoning', 'sandbox'].includes(categoryName);
  }

  formatCategoryName(categoryName) {
    return categoryName.charAt(0).toUpperCase() + categoryName.slice(1).replace(/([A-Z])/g, ' $1');
  }

  updateFlags() {
    const checkboxes = document.querySelectorAll('.flag-checkbox:checked');
    const radios = document.querySelectorAll('.flag-radio:checked');

    this.selectedFlags = [
      ...Array.from(checkboxes).map(cb => cb.value),
      ...Array.from(radios).map(radio => radio.value)
    ];

    console.log('Selected flags:', this.selectedFlags);
  }

  applyPreset(presetType) {
    if (!this.selectedAgent || !this.agentConfigs) return;

    const agent = this.agentConfigs.find(a => a.id === this.selectedAgent);
    if (!agent) return;

    // Clear current selections
    document.querySelectorAll('.flag-checkbox, .flag-radio').forEach(input => {
      input.checked = false;
    });

    let flagsToEnable = [];

    if (presetType === 'default') {
      // Enable default flags
      flagsToEnable = agent.flags.filter(f => f.default).map(f => f.id);
    } else if (presetType === 'powerful') {
      // Enable most powerful flags
      if (this.selectedAgent === 'claude') {
        flagsToEnable = ['skipPermissions'];
      } else if (this.selectedAgent === 'codex') {
        flagsToEnable = ['gpt5Model', 'highReasoning', 'bypassAll'];
      }
    }

    // Enable selected flags
    flagsToEnable.forEach(flagId => {
      const input = document.getElementById(`flag-${flagId}`);
      if (input) input.checked = true;
    });

    // Update visual feedback
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-preset="${presetType}"]`)?.classList.add('active');

    this.updateFlags();
  }

  startAgent() {
    if (!this.selectedAgent || !this.selectedMode || !this.currentSessionId) {
      console.error('Missing required selection');
      return;
    }

    const config = {
      agentId: this.selectedAgent,
      mode: this.selectedMode,
      flags: this.selectedFlags
    };

    console.log('Starting agent with config:', config);

    // Send to orchestrator
    this.orchestrator.startAgentWithConfig(this.currentSessionId, config);

    // Hide modal
    this.hideModal();
  }
}

// Make it globally available
window.AgentModalManager = AgentModalManager;