/**
 * Agent Manager - Centralized configuration for multiple AI agents
 * Supports Claude, Codex, and any custom CLI agent registered via
 * ~/.agent-workspace/custom-agents.json (see config/custom-agents.example.json).
 */

const fs = require('fs');
const path = require('path');

const { isSafeModel, isSafeReasoning, isSafeFlag } = require('./utils/shellSafety');

const CUSTOM_AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// A model/reasoning flag template must contain its single placeholder and only
// shell-safe surrounding characters (double-quotes allowed — the codex default
// is `-c model_reasoning_effort="{reasoning}"`; the interpolated VALUE is
// separately validated by isSafeModel/isSafeReasoning, so quotes in the
// template itself can't introduce injection).
const MODEL_TEMPLATE_RE = /^[A-Za-z0-9 _\-=./:@,+"]*\{model\}[A-Za-z0-9 _\-=./:@,+"]*$/;
const REASONING_TEMPLATE_RE = /^[A-Za-z0-9 _\-=./:@,+"]*\{reasoning\}[A-Za-z0-9 _\-=./:@,+"]*$/;

class AgentManager {
  constructor({ customAgentsPath } = {}) {
    this.agentConfigs = new Map();
    this.customAgentsPath = customAgentsPath || this.defaultCustomAgentsPath();
    this.initializeAgents();
    this.loadCustomAgents();
  }

  defaultCustomAgentsPath() {
    try {
      const { getAgentWorkspaceDir } = require('./utils/pathUtils');
      return path.join(getAgentWorkspaceDir(), 'custom-agents.json');
    } catch {
      return null;
    }
  }

  /**
   * Merge user-defined agents (Gemini, OpenCode, Grok, aider, ...) from a
   * JSON file into the registry. Everything downstream is registry-driven —
   * launch flags, init delay, model/effort flag syntax, the /api/agents UI,
   * review-workflow stages — so a new CLI needs zero code, only config.
   * Never throws: a bad file logs and is skipped.
   */
  loadCustomAgents() {
    const filePath = this.customAgentsPath;
    if (!filePath) return;
    try {
      if (!fs.existsSync(filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const agents = parsed && typeof parsed === 'object' ? parsed.agents : null;
      if (!agents || typeof agents !== 'object') return;

      for (const [rawId, cfg] of Object.entries(agents)) {
        const id = String(rawId || '').trim().toLowerCase();
        try {
          const normalized = this.normalizeCustomAgent(id, cfg);
          this.agentConfigs.set(id, normalized);
        } catch (e) {
          console.warn(`[agentManager] Skipping custom agent '${rawId}': ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`[agentManager] Failed to load custom agents from ${filePath}: ${e.message}`);
    }
  }

  validatedTemplate(value, re, id, field) {
    if (!value) return undefined;
    const str = String(value);
    if (!re.test(str)) {
      throw new Error(`${field} template contains unsafe characters or lacks its placeholder`);
    }
    return str;
  }

  normalizeCustomAgent(id, cfg) {
    if (!CUSTOM_AGENT_ID_RE.test(id)) throw new Error('invalid id (lowercase letters/digits/dashes)');
    if (!cfg || typeof cfg !== 'object') throw new Error('config must be an object');
    if (this.agentConfigs.has(id) && !cfg.override) {
      throw new Error(`'${id}' already exists (set "override": true to replace the built-in)`);
    }

    const baseCommand = String(cfg.baseCommand || id).trim();
    if (!baseCommand) throw new Error('baseCommand is required');

    const modes = {};
    const rawModes = cfg.modes && typeof cfg.modes === 'object' ? cfg.modes : {};
    for (const [modeId, mode] of Object.entries(rawModes)) {
      const command = String(mode?.command || '').trim();
      if (!command) continue;
      modes[modeId] = { command, description: String(mode?.description || '') };
    }
    if (!modes.fresh) modes.fresh = { command: baseCommand, description: 'Start new session' };

    const flags = {};
    const rawFlags = cfg.flags && typeof cfg.flags === 'object' ? cfg.flags : {};
    for (const [flagId, flag] of Object.entries(rawFlags)) {
      const flagStr = String(flag?.flag || '').trim();
      if (!flagStr) continue;
      // Flag strings are written to a shell; reject shell metacharacters.
      if (!isSafeFlag(flagStr)) {
        throw new Error(`flag '${flagId}' contains unsafe shell characters`);
      }
      flags[flagId] = {
        flag: flagStr,
        description: String(flag?.description || ''),
        label: String(flag?.label || flagId),
        category: String(flag?.category || 'general'),
        default: !!flag?.default
      };
    }

    const defaultFlags = (Array.isArray(cfg.defaultFlags) ? cfg.defaultFlags : [])
      .map(f => String(f || '').trim())
      .filter(f => f && flags[f]);

    const initDelayMs = Number(cfg.initDelayMs);

    return {
      id,
      name: String(cfg.name || id),
      icon: String(cfg.icon || '🤖'),
      description: String(cfg.description || `Custom agent: ${id}`),
      baseCommand,
      modes,
      flags,
      defaultMode: modes[cfg.defaultMode] ? String(cfg.defaultMode) : 'fresh',
      defaultFlags,
      availableFlags: Object.keys(flags),
      flagCategories: cfg.flagCategories && typeof cfg.flagCategories === 'object' ? cfg.flagCategories : {},
      models: Array.isArray(cfg.models) ? cfg.models.map(m => String(m)) : undefined,
      defaultModel: cfg.defaultModel ? String(cfg.defaultModel) : undefined,
      // Per-agent CLI syntax for model/effort selection, e.g. "--model {model}".
      // Reject templates with shell metacharacters at load time.
      modelFlag: this.validatedTemplate(cfg.modelFlag, MODEL_TEMPLATE_RE, id, 'modelFlag'),
      reasoningFlag: this.validatedTemplate(cfg.reasoningFlag, REASONING_TEMPLATE_RE, id, 'reasoningFlag'),
      initDelayMs: Number.isFinite(initDelayMs) && initDelayMs >= 0 ? initDelayMs : undefined,
      custom: true
    };
  }

  /**
   * Spawn defaults used by automation (reviewer/fixer/workflow stages):
   * the agent's own defaultFlags (e.g. claude → skipPermissions, codex →
   * yolo) so unattended launches don't stall on approval prompts.
   */
  getSpawnFlags(agentId) {
    const agent = this.agentConfigs.get(agentId);
    if (!agent) return [];
    return Array.isArray(agent.defaultFlags) ? [...agent.defaultFlags] : [];
  }

  getInitDelayMs(agentId) {
    const agent = this.agentConfigs.get(agentId);
    if (Number.isFinite(agent?.initDelayMs)) return agent.initDelayMs;
    return agentId === 'codex' ? 15_000 : 8_000;
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
          default: true
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
      defaultFlags: ['skipPermissions'],
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
	          command: 'codex resume --last',
	          description: 'Continue most recent session'
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
	        // YOLO Mode
	        yolo: {
	          flag: '--dangerously-bypass-approvals-and-sandbox',
	          description: 'No approvals + no sandboxing (extremely dangerous)',
	          label: '🚀 YOLO Mode',
	          category: 'sandbox',
	          default: true  // Now default!
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
	      defaultFlags: ['yolo'],
	      availableFlags: ['yolo', 'workspaceWrite', 'readOnly', 'neverAsk', 'askOnRequest'],
	      flagCategories: {
	        sandbox: { name: 'Sandbox Mode', mutuallyExclusive: true },
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

	      // Inject explicit resume id when supported.
	      if (mode === 'resume' && config.resumeId) {
	        if (agentId === 'claude') {
	          // Claude expects the resume id immediately after `--resume`.
	          command = `${modeConfig.command} ${config.resumeId}`;
	        }
	      }

	      // Add model if specified. Agents declare their own CLI syntax via
	      // `modelFlag` (e.g. "--model {model}"); default is codex-style `-m`.
	      // Both the value AND the template are validated — this string is
	      // written to a shell, so an unsafe model/template is dropped, not run.
	      if (config.model && (agent.models || agent.modelFlag)) {
	        const modelTemplate = agent.modelFlag || '-m {model}';
	        if (isSafeModel(config.model) && MODEL_TEMPLATE_RE.test(modelTemplate)) {
	          command += ` ${modelTemplate.replace('{model}', config.model)}`;
	        }
	      }

      // Add reasoning level if the agent supports one (codex declares
      // reasoningLevels; custom agents declare their own reasoningFlag).
      if (config.reasoning && (agent.reasoningLevels || agent.reasoningFlag)) {
        const reasoningTemplate = agent.reasoningFlag || '-c model_reasoning_effort="{reasoning}"';
        if (isSafeReasoning(config.reasoning) && REASONING_TEMPLATE_RE.test(reasoningTemplate)) {
          command += ` ${reasoningTemplate.replace('{reasoning}', config.reasoning)}`;
        }
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

	      if (agentId === 'codex' && mode === 'resume' && config.resumeId) {
	        // Codex expects options first, then the session id.
	        command += ` ${config.resumeId}`;
	      }
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
