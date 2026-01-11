/**
 * VoiceCommandService - Parse voice commands and execute orchestrator actions
 *
 * Parsing strategy (inspired by start-finishing-guide):
 * 1. Rule-based parsing first (instant, 0 tokens)
 * 2. LLM fallback for fuzzy matching:
 *    - Ollama (local, private, free) - preferred
 *    - Claude API (fast, cheap ~$0.00025/call) - fallback
 * 3. Context-aware parsing with workspace/session info
 */

const commandRegistry = require('./commandRegistry');

class VoiceCommandService {
  constructor() {
    // Ollama config (local LLM)
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:1b'; // Small, fast model
    this.useOllama = false;

    // Claude API config (external, fast)
    this.claudeApiKey = process.env.ANTHROPIC_API_KEY || null;
    this.claudeModel = process.env.CLAUDE_VOICE_MODEL || 'claude-3-haiku-20240307';
    this.useClaude = false;

    // Current context (set by orchestrator)
    this.context = {
      currentWorkspace: null,
      currentWorktree: null,
      activeSession: null,
      workspaces: [],
      worktrees: []
    };

    // Command patterns for rule-based parsing
    this.patterns = [
      // Focus worktree
      {
        patterns: [
          /focus\s+(?:on\s+)?(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
          /show\s+(?:only\s+)?(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
          /solo\s+(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
        ],
        command: 'focus-worktree',
        extractParams: (match) => {
          const num = match[1].replace(/\D/g, '');
          return { worktreeId: `work${num}` };
        }
      },
      // Show all worktrees
      {
        patterns: [
          /show\s+all/i,
          /unfocus/i,
          /reset\s+view/i,
          /view\s+all/i,
        ],
        command: 'show-all-worktrees',
        extractParams: () => ({})
      },
      // Switch workspace
      {
        patterns: [
          /switch\s+(?:to\s+)?workspace\s+(.+)/i,
          /open\s+workspace\s+(.+)/i,
          /go\s+to\s+(.+)/i,
        ],
        command: 'switch-workspace',
        extractParams: (match) => ({ name: match[1].trim() })
      },
      // Start Claude
      {
        patterns: [
          /start\s+claude\s+(?:in\s+)?(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
          /launch\s+claude\s+(?:in\s+)?(\d+|work\s*\d+)/i,
        ],
        command: 'start-claude',
        extractParams: (match) => {
          const num = match[1].replace(/\D/g, '');
          return { sessionId: `work${num}-claude` };
        }
      },
      // Stop session
      {
        patterns: [
          /stop\s+(?:session\s+)?(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
          /kill\s+(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
        ],
        command: 'stop-session',
        extractParams: (match) => {
          const num = match[1].replace(/\D/g, '');
          return { sessionId: `work${num}-claude` };
        }
      },
      // Open Commander
      {
        patterns: [
          /open\s+commander/i,
          /show\s+commander/i,
        ],
        command: 'open-commander',
        extractParams: () => ({})
      },
      // Open settings
      {
        patterns: [
          /open\s+settings/i,
          /show\s+settings/i,
        ],
        command: 'open-settings',
        extractParams: () => ({})
      },
      // Highlight worktree
      {
        patterns: [
          /highlight\s+(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
          /find\s+(?:work\s*tree\s+)?(\d+|work\s*\d+)/i,
        ],
        command: 'highlight-worktree',
        extractParams: (match) => {
          const num = match[1].replace(/\D/g, '');
          return { worktreeId: `work${num}` };
        }
      },
      // List sessions
      {
        patterns: [
          /list\s+sessions/i,
          /show\s+sessions/i,
          /what.*sessions/i,
        ],
        command: 'list-sessions',
        extractParams: () => ({})
      },
    ];

    this.checkLLMAvailability();
  }

  /**
   * Set current context for better command parsing
   */
  setContext(context) {
    this.context = { ...this.context, ...context };
  }

  /**
   * Check which LLM backends are available
   * Priority: Ollama (local) > Claude API (external)
   */
  async checkLLMAvailability() {
    // Check Ollama first (preferred - local, private)
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map(m => m.name) || [];
        console.log('[Voice] Ollama available with models:', models);
        this.useOllama = true;

        // Check if our preferred model is available
        const hasPreferred = models.some(m => m.startsWith(this.ollamaModel.split(':')[0]));
        if (!hasPreferred && models.length > 0) {
          // Use first available small model
          const smallModel = models.find(m =>
            m.includes('llama3.2:1b') || m.includes('phi') || m.includes('qwen')
          ) || models[0];
          console.log(`[Voice] Using model: ${smallModel}`);
          this.ollamaModel = smallModel;
        }
      }
    } catch (err) {
      console.log('[Voice] Ollama not available');
      this.useOllama = false;
    }

    // Check Claude API (fallback - external but fast)
    if (this.claudeApiKey) {
      this.useClaude = true;
      console.log('[Voice] Claude API available as fallback');
    }

    if (!this.useOllama && !this.useClaude) {
      console.log('[Voice] No LLM available - using rule-based parsing only');
    }
  }

  /**
   * Parse voice command using rules first, then LLM fallback
   */
  async parseCommand(transcript) {
    // Clean up transcript
    const text = transcript.toLowerCase().trim();

    // Try rule-based parsing first (instant, free)
    const ruleResult = this.parseWithRules(text);
    if (ruleResult) {
      return {
        success: true,
        method: 'rules',
        ...ruleResult
      };
    }

    // Try Ollama first (local, private)
    if (this.useOllama) {
      const ollamaResult = await this.parseWithOllama(text);
      if (ollamaResult) {
        return {
          success: true,
          method: 'ollama',
          ...ollamaResult
        };
      }
    }

    // Try Claude API as fallback (fast, cheap)
    if (this.useClaude) {
      const claudeResult = await this.parseWithClaude(text);
      if (claudeResult) {
        return {
          success: true,
          method: 'claude',
          ...claudeResult
        };
      }
    }

    return {
      success: false,
      error: 'Could not understand command',
      transcript: text
    };
  }

  /**
   * Rule-based command parsing
   */
  parseWithRules(text) {
    for (const rule of this.patterns) {
      for (const pattern of rule.patterns) {
        const match = text.match(pattern);
        if (match) {
          return {
            command: rule.command,
            params: rule.extractParams(match),
            confidence: 0.9
          };
        }
      }
    }
    return null;
  }

  /**
   * Build the LLM prompt with context (shared between Ollama and Claude)
   */
  buildLLMPrompt(text) {
    const capabilities = commandRegistry.getCapabilities();

    // Build command list with descriptions
    const commandList = Object.entries(capabilities)
      .map(([category, commands]) =>
        commands.map(c => `${c.name}: ${c.description}`).join('\n')
      ).join('\n');

    // Build context string with detailed worktree info
    const ctx = this.context;

    // Format worktrees with branches for better matching
    let worktreeList = '';
    if (ctx.worktreeDetails?.length) {
      worktreeList = ctx.worktreeDetails
        .map(w => `  ${w.id} (branch: ${w.branch})`)
        .join('\n');
    } else if (ctx.worktrees?.length) {
      worktreeList = ctx.worktrees.map(w => `  ${w}`).join('\n');
    }

    const contextStr = [
      ctx.currentWorkspace ? `Current workspace: ${ctx.currentWorkspace}` : null,
      ctx.workspaces?.length ? `Available workspaces: ${ctx.workspaces.join(', ')}` : null,
      worktreeList ? `Available worktrees:\n${worktreeList}` : null,
    ].filter(Boolean).join('\n');

    return `Classify this voice command for a developer orchestrator tool.

User said: "${text}"

${contextStr ? `Context:\n${contextStr}\n` : ''}
Available commands:
${commandList}

Command patterns:
- "focus on X" or "show X" → focus-worktree with worktreeId
- "show all" or "view all" → show-all-worktrees
- "switch to X" or "open X workspace" → switch-workspace with name
- "start claude in X" → start-claude with sessionId
- "open commander" → open-commander
- "open settings" → open-settings

Worktree matching:
- "zoo game work 1" → worktreeId: "zoo-game-work1"
- "work 3" → worktreeId: "work3" (if single project)
- Match partial names: "zoo" could match "zoo-game"

Return JSON: {"command": "command-name", "params": {"key": "value"}}
Return {"command": null} if unclear.

JSON:`;
  }

  /**
   * Parse LLM JSON response
   */
  parseLLMResponse(responseText) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.command && parsed.command !== null) {
          return {
            command: parsed.command,
            params: parsed.params || {},
            confidence: 0.7
          };
        }
      }
    } catch (err) {
      console.error('[Voice] Failed to parse LLM response:', err.message);
    }
    return null;
  }

  /**
   * LLM-based command parsing via Ollama (local)
   */
  async parseWithOllama(text) {
    const prompt = this.buildLLMPrompt(text);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 100
          }
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) return null;

      const data = await response.json();
      return this.parseLLMResponse(data.response);
    } catch (err) {
      console.error('[Voice] Ollama parsing failed:', err.message);
    }
    return null;
  }

  /**
   * LLM-based command parsing via Claude API (external fallback)
   */
  async parseWithClaude(text) {
    const prompt = this.buildLLMPrompt(text);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.claudeApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.claudeModel,
          max_tokens: 100,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        console.error('[Voice] Claude API error:', response.status);
        return null;
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';
      return this.parseLLMResponse(content);
    } catch (err) {
      console.error('[Voice] Claude parsing failed:', err.message);
    }
    return null;
  }

  /**
   * Execute a parsed command
   */
  async executeCommand(command, params) {
    return await commandRegistry.execute(command, params);
  }

  /**
   * Parse and execute in one call
   */
  async processVoiceCommand(transcript) {
    const parsed = await this.parseCommand(transcript);

    if (!parsed.success) {
      return parsed;
    }

    const result = await this.executeCommand(parsed.command, parsed.params);

    return {
      ...parsed,
      executed: true,
      result
    };
  }

  /**
   * Get available voice commands for help
   */
  getVoiceCommands() {
    return this.patterns.map(p => ({
      command: p.command,
      examples: p.patterns.map(pat =>
        pat.source
          .replace(/\\s\+/g, ' ')
          .replace(/\\d\+/g, 'N')
          .replace(/\(\?:.*?\)/g, '')
          .replace(/[\\^$.*+?()[\]{}|]/g, '')
          .replace(/i$/, '')
          .trim()
      ).slice(0, 2)
    }));
  }

  /**
   * Get LLM backend status
   */
  getLLMStatus() {
    return {
      ollama: {
        available: this.useOllama,
        url: this.ollamaUrl,
        model: this.ollamaModel
      },
      claude: {
        available: this.useClaude,
        model: this.claudeModel,
        hasApiKey: !!this.claudeApiKey
      },
      activeBackend: this.useOllama ? 'ollama' : (this.useClaude ? 'claude' : 'rules-only'),
      context: {
        currentWorkspace: this.context.currentWorkspace,
        currentWorktree: this.context.currentWorktree
      }
    };
  }

  /**
   * Re-check LLM availability (useful after config changes)
   */
  async refreshLLMStatus() {
    await this.checkLLMAvailability();
    return this.getLLMStatus();
  }
}

// Singleton
const voiceCommandService = new VoiceCommandService();
module.exports = voiceCommandService;
