/**
 * Agent Manager - Centralized configuration for multiple AI agents
 * Supports Claude, Codex, and extensible for future agents
 */

class AgentManager {
  constructor() {
    this.agentConfigs = new Map();
    this.initializeAgents();
  }

  initializeAgents() {
    // Claude Configuration
    this.agentConfigs.set('claude', {
      id: 'claude',
      name: 'Claude',
      icon: '🤖',
      description: 'Anthropic Claude Code',
      baseCommand: 'claude',
      modes: {
        fresh: {
          command: 'claude',
          description: 'Start new session'
        },
        continue: {
          command: 'claude --continue',
          description: 'Resume conversation'
        },
        resume: {
          command: 'claude --resume',
          description: 'Restore interrupted session'
        }
      },
      flags: {
        // Permissions
        skipPermissions: {
          flag: '--dangerously-skip-permissions',
          description: 'YOLO Mode (skip permissions)',
          label: '🚀 YOLO Mode',
          category: 'permissions',
          default: false
        },

        // Future Claude flags (examples for extensibility)
        verbose: {
          flag: '--verbose',
          description: 'Verbose output mode',
          label: '📝 Verbose',
          category: 'output',
          default: false
        },
        debug: {
          flag: '--debug',
          description: 'Debug mode with detailed logging',
          label: '🐛 Debug',
          category: 'output',
          default: false
        }
      },
      defaultMode: 'fresh',
      defaultFlags: [], // Default is no flags (safe mode)
      availableFlags: ['skipPermissions', 'verbose', 'debug'],
      flagCategories: {
        permissions: { name: 'Permissions', mutuallyExclusive: false },
        output: { name: 'Output Options', mutuallyExclusive: false }
      }
    });

    // Codex Configuration
    this.agentConfigs.set('codex', {
      id: 'codex',
      name: 'Codex',
      icon: '⚡',
      description: 'OpenAI Codex',
      baseCommand: 'codex',
      modes: {
        fresh: {
          command: 'codex',
          description: 'Start new session'
        },
        continue: {
          command: 'codex',
          description: 'Continue conversation'
        },
        resume: {
          command: 'codex resume',
          description: 'Resume interrupted session'
        }
      },
      flags: {
        // Model Selection
        gpt5Model: {
          flag: '--model=gpt-5-codex',
          description: 'Use GPT-5 Codex model',
          label: '🔥 GPT-5 Model',
          category: 'model',
          default: true
        },
        gpt6Model: {
          flag: '--model=gpt-6-codex',
          description: 'Use GPT-6 Codex model (future)',
          label: '🚀 GPT-6 Model',
          category: 'model',
          default: false
        },

        // Reasoning Level
        highReasoning: {
          flag: '-c model_reasoning_effort="high"',
          description: 'High reasoning effort',
          label: '🧠 High Reasoning',
          category: 'reasoning',
          default: true
        },
        mediumReasoning: {
          flag: '-c model_reasoning_effort="medium"',
          description: 'Medium reasoning effort',
          label: '🤔 Medium Reasoning',
          category: 'reasoning',
          default: false
        },
        lowReasoning: {
          flag: '-c model_reasoning_effort="low"',
          description: 'Low reasoning effort (faster)',
          label: '⚡ Low Reasoning',
          category: 'reasoning',
          default: false
        },

        // Sandbox & Permissions
        workspaceWrite: {
          flag: '--sandbox workspace-write -c sandbox_workspace_write.network_access=true',
          description: 'Workspace write with network access',
          label: '📝 Workspace + Network',
          category: 'sandbox',
          default: true
        },
        bypassAll: {
          flag: '--dangerously-bypass-approvals-and-sandbox',
          description: 'Bypass all safety (maximum power)',
          label: '🚀 Full Bypass',
          category: 'sandbox',
          default: false
        },

        // Performance
        fastMode: {
          flag: '--fast',
          description: 'Prioritize speed over accuracy',
          label: '⚡ Fast Mode',
          category: 'performance',
          default: false
        },
        thoroughMode: {
          flag: '--thorough',
          description: 'Prioritize accuracy over speed',
          label: '🔍 Thorough Mode',
          category: 'performance',
          default: false
        }
      },
      defaultMode: 'fresh',
      // Default flags for "most powerful" configuration
      defaultFlags: ['gpt5Model', 'highReasoning', 'workspaceWrite'],
      flagCategories: {
        model: { name: 'Model', mutuallyExclusive: true },
        reasoning: { name: 'Reasoning Level', mutuallyExclusive: true },
        sandbox: { name: 'Permissions', mutuallyExclusive: true },
        performance: { name: 'Performance', mutuallyExclusive: true }
      }
    });
  }

  /**
   * Get all available agents
   */
  getAllAgents() {
    return Array.from(this.agentConfigs.values());
  }

  /**
   * Get specific agent configuration
   */
  getAgent(agentId) {
    return this.agentConfigs.get(agentId);
  }

  /**
   * Build command for specific agent, mode, and flags
   */
  buildCommand(agentId, mode, enabledFlags = []) {
    const agent = this.agentConfigs.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const modeConfig = agent.modes[mode];
    if (!modeConfig) {
      throw new Error(`Unknown mode '${mode}' for agent '${agentId}'`);
    }

    let command = modeConfig.command;

    // Add enabled flags
    enabledFlags.forEach(flagId => {
      const flag = agent.flags[flagId];
      if (flag) {
        command += ` ${flag.flag}`;
      }
    });

    return command;
  }

  /**
   * Get default configuration for an agent
   */
  getDefaultConfig(agentId) {
    const agent = this.agentConfigs.get(agentId);
    if (!agent) return null;

    return {
      agentId,
      mode: agent.defaultMode,
      flags: agent.defaultFlags || []
    };
  }

  /**
   * Get "most powerful" configuration for an agent
   */
  getPowerfulConfig(agentId) {
    const agent = this.agentConfigs.get(agentId);
    if (!agent) return null;

    // For agents with defaultFlags, use those
    if (agent.defaultFlags && agent.defaultFlags.length > 0) {
      return {
        agentId,
        mode: agent.defaultMode,
        flags: [...agent.defaultFlags]
      };
    }

    // Fallback: find the most "powerful" flags
    const powerfulFlags = Object.entries(agent.flags)
      .filter(([_, config]) => config.category === 'sandbox' || config.category === 'permissions')
      .map(([flagId, _]) => flagId);

    return {
      agentId,
      mode: agent.defaultMode,
      flags: powerfulFlags
    };
  }

  /**
   * Handle mutually exclusive flags
   */
  validateAndAdjustFlags(agentId, flags) {
    const agent = this.agentConfigs.get(agentId);
    if (!agent) return flags;

    const adjustedFlags = [...flags];
    const categories = agent.flagCategories || {};

    // Handle mutually exclusive categories
    Object.entries(categories).forEach(([categoryId, categoryConfig]) => {
      if (categoryConfig.mutuallyExclusive) {
        // Find flags in this category
        const categoryFlags = adjustedFlags.filter(flagId => {
          const flag = agent.flags[flagId];
          return flag && flag.category === categoryId;
        });

        // If multiple flags in exclusive category, keep only the last one
        if (categoryFlags.length > 1) {
          const lastFlag = categoryFlags[categoryFlags.length - 1];
          // Remove all but the last flag
          categoryFlags.slice(0, -1).forEach(flagId => {
            const index = adjustedFlags.indexOf(flagId);
            if (index > -1) adjustedFlags.splice(index, 1);
          });
        }
      }
    });

    return adjustedFlags;
  }

  /**
   * Validate agent configuration
   */
  validateConfig(config) {
    const { agentId, mode, flags = [] } = config;

    const agent = this.agentConfigs.get(agentId);
    if (!agent) {
      return { valid: false, error: `Unknown agent: ${agentId}` };
    }

    if (!agent.modes[mode]) {
      return { valid: false, error: `Unknown mode '${mode}' for agent '${agentId}'` };
    }

    const invalidFlags = flags.filter(flag => !agent.flags[flag]);
    if (invalidFlags.length > 0) {
      return { valid: false, error: `Unknown flags for agent '${agentId}': ${invalidFlags.join(', ')}` };
    }

    return { valid: true };
  }

  /**
   * Get agent-specific UI configuration
   */
  getUIConfig(agentId) {
    const agent = this.agentConfigs.get(agentId);
    if (!agent) return null;

    return {
      id: agent.id,
      name: agent.name,
      icon: agent.icon,
      description: agent.description,
      modes: Object.entries(agent.modes).map(([key, mode]) => ({
        id: key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        description: mode.description
      })),
      flags: (agent.availableFlags || []).map(flagId => ({
        id: flagId,
        ...agent.flags[flagId]
      })),
      defaultMode: agent.defaultMode
    };
  }
}

module.exports = AgentManager;