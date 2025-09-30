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
      description: 'OpenAI Codex CLI',
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
      // Supported models
      models: ['gpt-4', 'gpt-5', 'gpt-5-codex'],
      defaultModel: 'gpt-5-codex',

      // Reasoning levels
      reasoningLevels: ['low', 'medium', 'high'],
      defaultReasoning: 'high',

      // Verbosity levels
      verbosityLevels: ['low', 'medium', 'high'],
      defaultVerbosity: 'high',

      flags: {
        // YOLO Mode (replaces old bypassAll)
        yolo: {
          flag: '--yolo',
          description: 'Full automation: no approvals + full system access',
          label: '🚀 YOLO Mode',
          category: 'sandbox',
          default: true  // Now default!
        },

        // Network Access
        networkAccess: {
          flag: '-c sandbox_workspace_write.network_access=true',
          description: 'Enable network access for package installs/API calls',
          label: '🌐 Network Access',
          category: 'network',
          default: true
        },

        // Web Search
        search: {
          flag: '--search',
          description: 'Enable safe web search tool for documentation',
          label: '🔍 Web Search',
          category: 'network',
          default: true
        },

        // Workspace Write (alternative to YOLO)
        workspaceWrite: {
          flag: '--sandbox workspace-write',
          description: 'Write files in workspace only (safer than YOLO)',
          label: '📝 Workspace Write',
          category: 'sandbox',
          default: false
        },

        // Read Only (safest)
        readOnly: {
          flag: '--sandbox read-only',
          description: 'Read-only access (safest, no modifications)',
          label: '👀 Read Only',
          category: 'sandbox',
          default: false
        },

        // Approval policies (alternatives to YOLO)
        neverAsk: {
          flag: '--ask-for-approval never',
          description: 'Never ask for permission',
          label: '⚡ Never Ask',
          category: 'approvals',
          default: false
        },

        askOnRequest: {
          flag: '--ask-for-approval on-request',
          description: 'Ask only on risky operations',
          label: '🛡️ Ask on Risk',
          category: 'approvals',
          default: false
        }
      },
      defaultMode: 'fresh',
      // Default flags for "maximum power" configuration
      defaultFlags: ['yolo', 'networkAccess', 'search'],
      availableFlags: ['yolo', 'networkAccess', 'search', 'workspaceWrite', 'readOnly', 'neverAsk', 'askOnRequest'],
      flagCategories: {
        sandbox: { name: 'Sandbox Mode', mutuallyExclusive: true },
        network: { name: 'Network & Search', mutuallyExclusive: false },
        approvals: { name: 'Approval Policy', mutuallyExclusive: true }
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
   * Build command for specific agent, mode, and configuration
   * Supports both config object and enabledFlags array for backwards compatibility
   */
  buildCommand(agentId, mode, configOrFlags = []) {
    const agent = this.agentConfigs.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const modeConfig = agent.modes[mode];
    if (!modeConfig) {
      throw new Error(`Unknown mode '${mode}' for agent '${agentId}'`);
    }

    let command = modeConfig.command;

    // Handle new config object format (for Codex with model/reasoning/verbosity)
    if (typeof configOrFlags === 'object' && !Array.isArray(configOrFlags)) {
      const config = configOrFlags;

      // Add model if specified (Codex)
      if (config.model && agent.models) {
        command += ` -m ${config.model}`;
      }

      // Add reasoning level if specified (Codex)
      if (config.reasoning) {
        command += ` -c model_reasoning_effort="${config.reasoning}"`;
      }

      // Add verbosity level if specified (Codex)
      if (config.verbosity) {
        command += ` -c model_verbosity="${config.verbosity}"`;
      }

      // Add flags
      const enabledFlags = config.flags || [];
      enabledFlags.forEach(flagId => {
        const flag = agent.flags[flagId];
        if (flag) {
          command += ` ${flag.flag}`;
        }
      });
    } else {
      // Backwards compatibility: treat as array of flags
      const enabledFlags = Array.isArray(configOrFlags) ? configOrFlags : [];
      enabledFlags.forEach(flagId => {
        const flag = agent.flags[flagId];
        if (flag) {
          command += ` ${flag.flag}`;
        }
      });
    }

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