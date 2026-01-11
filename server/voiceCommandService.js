/**
 * VoiceCommandService - Parse voice commands and execute orchestrator actions
 *
 * Supports:
 * 1. Rule-based parsing (fast, no external deps)
 * 2. Local LLM via Ollama (smarter parsing)
 * 3. Direct API execution
 */

const commandRegistry = require('./commandRegistry');

class VoiceCommandService {
  constructor() {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:1b'; // Small, fast model
    this.useOllama = false; // Will be set to true if Ollama is available

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
          /switch\s+(?:to\s+)?(?:workspace\s+)?(.+)/i,
          /open\s+(?:workspace\s+)?(.+)/i,
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

    this.checkOllamaAvailability();
  }

  /**
   * Check if Ollama is running locally
   */
  async checkOllamaAvailability() {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        const data = await response.json();
        console.log('Ollama available with models:', data.models?.map(m => m.name) || []);
        this.useOllama = true;
      }
    } catch (err) {
      console.log('Ollama not available, using rule-based parsing only');
      this.useOllama = false;
    }
  }

  /**
   * Parse voice command using rules first, then LLM fallback
   */
  async parseCommand(transcript) {
    // Clean up transcript
    const text = transcript.toLowerCase().trim();

    // Try rule-based parsing first (fast)
    const ruleResult = this.parseWithRules(text);
    if (ruleResult) {
      return {
        success: true,
        method: 'rules',
        ...ruleResult
      };
    }

    // Try LLM parsing if available
    if (this.useOllama) {
      const llmResult = await this.parseWithLLM(text);
      if (llmResult) {
        return {
          success: true,
          method: 'llm',
          ...llmResult
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
   * LLM-based command parsing via Ollama
   */
  async parseWithLLM(text) {
    const capabilities = commandRegistry.getCapabilities();
    const commandList = Object.values(capabilities)
      .flat()
      .map(c => `- ${c.name}: ${c.description}`)
      .join('\n');

    const prompt = `You are a command parser for a development tool. Parse the user's voice command and return a JSON object with the matching command.

Available commands:
${commandList}

User said: "${text}"

Return ONLY a JSON object like: {"command": "command-name", "params": {"key": "value"}}
If you can't match a command, return: {"command": null, "error": "reason"}

JSON response:`;

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
      const jsonMatch = data.response.match(/\{[\s\S]*\}/);
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
      console.error('LLM parsing failed:', err.message);
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
}

// Singleton
const voiceCommandService = new VoiceCommandService();
module.exports = voiceCommandService;
