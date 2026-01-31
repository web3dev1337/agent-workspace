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
      // Workflow modes (focus/review/background)
      {
        patterns: [
          /(?:enter|switch\s+to|go\s+to)\s+(focus|review|background)\s+mode/i,
          /^(focus|review|background)\s+mode$/i,
        ],
        command: 'set-workflow-mode',
        extractParams: (match) => ({ mode: match[1].toLowerCase() })
      },
      // Focus: Tier 2 behavior (auto/always)
      {
        patterns: [
          /(?:tier\s*2|tier\s*two|t2)\s+(auto|always)/i,
          /show\s+(?:me\s+)?tier\s*(?:2|two)s?/i,
          /hide\s+tier\s*(?:2|two)s?/i,
        ],
        command: 'set-focus-tier2',
        extractParams: (match) => {
          const raw = (match[1] || '').toLowerCase();
          if (raw === 'auto' || raw === 'always') return { behavior: raw };
          if (/^hide/i.test(match[0])) return { behavior: 'auto' };
          return { behavior: 'always' };
        }
      },
      // Open Queue
      {
        patterns: [
          /(?:start|open)\s+next\s+review/i,
          /review\s+next/i,
          /next\s+review/i,
        ],
        command: 'queue-next',
        extractParams: () => ({})
      },
      // Open Queue (blockers)
      {
        patterns: [
          /show\s+blockers/i,
          /show\s+blocked/i,
          /show\s+blocking/i,
          /what'?s\s+blocking/i,
          /what\s+is\s+blocking/i,
          /open\s+blockers/i,
        ],
        command: 'queue-blockers',
        extractParams: () => ({})
      },
      // Open Queue (triage)
      {
        patterns: [
          /triage\s+queue/i,
          /open\s+triage/i,
          /enable\s+triage/i,
          /triage\s+mode/i,
        ],
        command: 'queue-triage',
        extractParams: () => ({})
      },
      // Open Queue (Conveyor T2)
      {
        patterns: [
          /conveyor\s+t2/i,
          /conveyor\s+tier\s*2/i,
          /start\s+conveyor/i,
          /review\s+conveyor/i,
        ],
        command: 'queue-conveyor-t2',
        extractParams: () => ({})
      },
      // Queue: open console (review console)
      {
        patterns: [
          /open\s+(?:the\s+)?console/i,
          /open\s+review\s+console/i,
          /show\s+review\s+console/i,
          /open\s+inspector\s+console/i,
        ],
        command: 'queue-open-console',
        extractParams: () => ({})
      },
      // Queue: open diff for selected item
      {
        patterns: [
          /open\s+diff/i,
          /show\s+diff/i,
          /open\s+pr\s+diff/i,
        ],
        command: 'queue-open-diff',
        extractParams: () => ({})
      },
      // Queue: approve selected PR
      {
        patterns: [
          /^(?:approve|lgtm)(?:\s+(?:this|the)\s+(?:pr|pull\s+request))?(?:\s*[:,-]?\s*(.+))?$/i,
          /approve\s+(?:this|the)\s+(?:pr|pull\s+request)(?:\s*[:,-]?\s*(.+))?$/i,
        ],
        command: 'queue-approve',
        extractParams: (match) => ({ body: String(match?.[1] || '').trim() || undefined })
      },
      // Queue: request changes for selected PR
      {
        patterns: [
          /^(?:request|ask\s+for)\s+changes(?:\s+(?:on\s+)?(?:this|the)\s+(?:pr|pull\s+request))?(?:\s*[:,-]?\s*(.+))?$/i,
          /changes\s+requested(?:\s*[:,-]?\s*(.+))?$/i,
        ],
        command: 'queue-request-changes',
        extractParams: (match) => ({ body: String(match?.[1] || '').trim() || undefined })
      },
      // Queue: merge selected PR (merge|squash|rebase)
      {
        patterns: [
          /^(squash|rebase)\s+merge(?:\s+(?:this|the)\s+(?:pr|pull\s+request))?$/i,
          /^(?:merge|ship)(?:\s+(?:this|the)\s+(?:pr|pull\s+request))?$/i,
        ],
        command: 'queue-merge',
        extractParams: (match) => ({ method: String(match?.[1] || '').trim().toLowerCase() || undefined })
      },
      // Open Queue
      {
        patterns: [
          /open\s+queue/i,
          /show\s+queue/i,
          /go\s+to\s+queue/i,
          /start\s+review/i,
        ],
        command: 'open-queue',
        extractParams: () => ({})
      },
      // Open Tasks (Trello)
      {
        patterns: [
          /open\s+tasks/i,
          /show\s+tasks/i,
          /open\s+trello/i,
          /show\s+trello/i,
        ],
        command: 'open-tasks',
        extractParams: () => ({})
      },
      // Open Advisor
      {
        patterns: [
          /open\s+advice/i,
          /show\s+advice/i,
          /open\s+advisor/i,
          /show\s+advisor/i,
          /what\s+should\s+i\s+do\s+next/i,
          /what\s+do\s+i\s+do\s+next/i,
          /what\s+should\s+i\s+work\s+on\s+next/i,
          /what\s+do\s+we\s+do\s+next/i,
        ],
        command: 'open-advice',
        extractParams: () => ({})
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
      // Open dashboard (home)
      {
        patterns: [
          /open\s+dashboard/i,
          /show\s+dashboard/i,
          /go\s+to\s+dashboard/i,
          /^dashboard$/i,
          /go\s+home/i,
        ],
        command: 'open-dashboard',
        extractParams: () => ({})
      },
      // Open PRs panel
      {
        patterns: [
          /open\s+prs/i,
          /show\s+prs/i,
          /open\s+pull\s+requests/i,
          /show\s+pull\s+requests/i,
          /open\s+pr\s+panel/i,
        ],
        command: 'open-prs',
        extractParams: () => ({})
      },
      // Open telemetry details
      {
        patterns: [
          /open\s+telemetry/i,
          /show\s+telemetry/i,
          /telemetry\s+details/i,
          /open\s+metrics/i,
          /show\s+metrics/i,
        ],
        command: 'open-telemetry',
        extractParams: () => ({})
      },
      // Open activity feed
      {
        patterns: [
          /open\s+activity/i,
          /show\s+activity/i,
          /activity\s+feed/i,
          /open\s+activity\s+feed/i,
          /show\s+activity\s+feed/i,
        ],
        command: 'open-activity',
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
      // Restart session
      {
        patterns: [
          /restart\s+(?:work\s*)?(\d+)/i,
          /restart\s+claude\s+(?:in\s+)?(?:work\s*)?(\d+)/i,
          /reboot\s+(?:work\s*)?(\d+)/i,
        ],
        command: 'restart-session',
        extractParams: (match) => {
          const num = match[1].replace(/\D/g, '');
          return { sessionId: `work${num}-claude` };
        }
      },
      // Kill session
      {
        patterns: [
          /kill\s+(?:work\s*)?(\d+)/i,
          /terminate\s+(?:work\s*)?(\d+)/i,
          /force\s+kill\s+(?:work\s*)?(\d+)/i,
        ],
        command: 'kill-session',
        extractParams: (match) => {
          const num = match[1].replace(/\D/g, '');
          return { sessionId: `work${num}-claude` };
        }
      },
      // Destroy session
      {
        patterns: [
          /destroy\s+(?:work\s*)?(\d+)(?:\s+session)?/i,
          /nuke\s+(?:work\s*)?(\d+)/i,
        ],
        command: 'destroy-session',
        extractParams: (match) => {
          const num = match[1].replace(/\D/g, '');
          return { sessionId: `work${num}-claude` };
        }
      },
      // Stop server
      {
        patterns: [
          /stop\s+server/i,
          /stop\s+server\s+(?:in\s+)?(?:work\s*)?(\d+)/i,
          /halt\s+server/i,
        ],
        command: 'stop-server',
        extractParams: (match) => {
          if (match[1]) {
            const num = match[1].replace(/\D/g, '');
            return { sessionId: `work${num}-server` };
          }
          return {};
        }
      },
      // Restart server
      {
        patterns: [
          /restart\s+server/i,
          /restart\s+server\s+(?:in\s+)?(?:work\s*)?(\d+)/i,
          /reboot\s+server/i,
        ],
        command: 'restart-server',
        extractParams: (match) => {
          if (match[1]) {
            const num = match[1].replace(/\D/g, '');
            return { sessionId: `work${num}-server` };
          }
          return {};
        }
      },
      // Kill server
      {
        patterns: [
          /kill\s+server/i,
          /force\s+kill\s+server/i,
          /terminate\s+server/i,
        ],
        command: 'kill-server',
        extractParams: () => ({})
      },
      // Build production
      {
        patterns: [
          /build\s+prod(?:uction)?/i,
          /production\s+build/i,
          /make\s+prod(?:uction)?/i,
        ],
        command: 'build-production',
        extractParams: () => ({})
      },
      // Start agent
      {
        patterns: [
          /start\s+agent/i,
          /start\s+aider/i,
          /launch\s+agent/i,
          /launch\s+aider/i,
        ],
        command: 'start-agent',
        extractParams: () => ({})
      },
      // Add worktree
      {
        patterns: [
          /add\s+work\s*tree/i,
          /new\s+work\s*tree/i,
          /create\s+work\s*tree/i,
        ],
        command: 'add-worktree',
        extractParams: () => ({})
      },
      // Remove worktree
      {
        patterns: [
          /remove\s+work\s*tree/i,
          /delete\s+work\s*tree/i,
          /destroy\s+work\s*tree/i,
        ],
        command: 'remove-worktree',
        extractParams: () => ({})
      },
      // Close tab
      {
        patterns: [
          /close\s+tab/i,
          /close\s+this\s+tab/i,
          /close\s+current\s+tab/i,
        ],
        command: 'close-tab',
        extractParams: () => ({})
      },
      // New tab
      {
        patterns: [
          /new\s+tab/i,
          /open\s+new\s+tab/i,
          /add\s+tab/i,
        ],
        command: 'new-tab',
        extractParams: () => ({})
      },
      // Open folder
      {
        patterns: [
          /open\s+folder/i,
          /show\s+(?:in\s+)?explorer/i,
          /open\s+(?:in\s+)?file\s+manager/i,
          /reveal\s+(?:in\s+)?folder/i,
        ],
        command: 'open-folder',
        extractParams: () => ({})
      },
      // Open diff viewer
      {
        patterns: [
          /open\s+diff/i,
          /show\s+diff/i,
          /code\s+review/i,
          /diff\s+viewer/i,
          /review\s+changes/i,
        ],
        command: 'open-diff-viewer',
        extractParams: () => ({})
      },
      // Scroll to top
      {
        patterns: [
          /scroll\s+(?:to\s+)?top/i,
          /go\s+(?:to\s+)?top/i,
          /jump\s+(?:to\s+)?top/i,
        ],
        command: 'scroll-to-top',
        extractParams: () => ({})
      },
      // Scroll to bottom
      {
        patterns: [
          /scroll\s+(?:to\s+)?bottom/i,
          /go\s+(?:to\s+)?bottom/i,
          /jump\s+(?:to\s+)?bottom/i,
        ],
        command: 'scroll-to-bottom',
        extractParams: () => ({})
      },
      // Clear terminal
      {
        patterns: [
          /clear\s+terminal/i,
          /clear\s+screen/i,
          /clear\s+console/i,
        ],
        command: 'clear-terminal',
        extractParams: () => ({})
      },
      // Git pull all
      {
        patterns: [
          /pull\s+all/i,
          /git\s+pull\s+all/i,
          /update\s+all\s+repos/i,
        ],
        command: 'git-pull-all',
        extractParams: () => ({})
      },
      // Git status all
      {
        patterns: [
          /status\s+all/i,
          /git\s+status\s+all/i,
          /show\s+all\s+status/i,
        ],
        command: 'git-status-all',
        extractParams: () => ({})
      },
      // Stop all claudes
      {
        patterns: [
          /stop\s+all\s+claudes?/i,
          /kill\s+all\s+claudes?/i,
          /terminate\s+all\s+claudes?/i,
        ],
        command: 'stop-all-claudes',
        extractParams: () => ({})
      },
      // Start all claudes
      {
        patterns: [
          /start\s+all\s+claudes?/i,
          /launch\s+all\s+claudes?/i,
          /boot\s+all\s+claudes?/i,
        ],
        command: 'start-all-claudes',
        extractParams: () => ({})
      },
      // Refresh all
      {
        patterns: [
          /refresh\s+all/i,
          /refresh\s+terminals?/i,
          /reload\s+all/i,
        ],
        command: 'refresh-all',
        extractParams: () => ({})
      },
    ];

    const skipAutoCheck = process.env.NODE_ENV === 'test'
      || process.env.JEST_WORKER_ID !== undefined
      || String(process.env.VOICE_SKIP_LLM_CHECK || '').toLowerCase() === 'true';

    if (!skipAutoCheck) {
      this.checkLLMAvailability();
    }
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

    // Build command list (include required params + 1 example if present)
    const commandList = Object.entries(capabilities)
      .map(([category, commands]) => {
        const lines = (commands || []).map((c) => {
          const params = Array.isArray(c.params) ? c.params : [];
          const required = params.filter(p => p && p.required).map(p => p.name).filter(Boolean);
          const example = Array.isArray(c.examples) && c.examples.length ? c.examples[0] : null;
          const exampleLine = example?.params ? ` e.g. ${JSON.stringify(example.params)}` : '';
          return `${c.name}${required.length ? ` (required: ${required.join(', ')})` : ''}: ${c.description}${exampleLine}`;
        });
        return lines.length ? [`[${category}]`, ...lines].join('\n') : '';
      })
      .filter(Boolean)
      .join('\n\n');

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
      ctx.activeSession ? `Active session: ${ctx.activeSession}` : null,
      ctx.selectedQueue?.id ? `Selected queue item: ${ctx.selectedQueue.id}${ctx.selectedQueue.title ? ` (${ctx.selectedQueue.title})` : ''}` : null,
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
- "enter focus/review/background mode" → set-workflow-mode with mode
- "tier 2 auto/always" → set-focus-tier2 with behavior
- "open queue" → open-queue
- "open tasks" → open-tasks
- "open advice" → open-advice
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
