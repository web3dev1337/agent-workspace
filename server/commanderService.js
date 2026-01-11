/**
 * Commander Service - Top-Level AI for orchestrating Claude sessions
 * Uses Claude API with tool calling to control workspaces, terminals, and projects
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/commander.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const COMMANDER_SYSTEM_PROMPT = `You are the Commander of the Claude Orchestrator - a top-level AI that can see and control all Claude sessions running in the orchestrator.

You have access to:
- All workspace configurations
- All running terminal sessions
- Port registry for managing server ports
- Project creation tools
- GitHub integration via terminal commands

Your role is to help the user manage their development environment efficiently. You can:
1. Create new projects with the greenfield wizard
2. Switch between workspaces
3. Send commands or messages to specific terminals
4. Get output from terminals to understand what's happening
5. Check port usage across all sessions
6. Coordinate work across multiple Claude sessions

Be helpful and proactive. When the user asks to do something, use the appropriate tools to accomplish it.
Provide clear, concise responses about what you're doing.`;

class CommanderService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.client = null;
    this.conversationHistory = [];
    this.sessionManager = options.sessionManager;
    this.workspaceManager = options.workspaceManager;
    this.portRegistry = options.portRegistry;
    this.greenfieldService = options.greenfieldService;
    this.io = options.io; // Socket.IO for real-time updates

    if (this.apiKey) {
      this.client = new Anthropic({ apiKey: this.apiKey });
      logger.info('Commander initialized with Anthropic API');
    } else {
      logger.warn('Commander initialized without API key - commands will be simulated');
    }
  }

  static getInstance(options) {
    if (!CommanderService.instance) {
      CommanderService.instance = new CommanderService(options);
    }
    return CommanderService.instance;
  }

  /**
   * Get the tools available to Commander
   */
  getTools() {
    return [
      {
        name: 'create_project',
        description: 'Create a new greenfield project with the specified template',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Project name (lowercase, letters/numbers/hyphens only)'
            },
            templateId: {
              type: 'string',
              enum: ['hytopia-game', 'node-typescript', 'empty'],
              description: 'Project template to use'
            },
            basePath: {
              type: 'string',
              description: 'Base path for the project (e.g., ~/GitHub/games)'
            },
            worktreeCount: {
              type: 'number',
              description: 'Number of worktrees to create (default: 4)'
            }
          },
          required: ['name', 'templateId', 'basePath']
        }
      },
      {
        name: 'list_workspaces',
        description: 'List all available workspaces',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'switch_workspace',
        description: 'Switch to a different workspace',
        input_schema: {
          type: 'object',
          properties: {
            workspaceId: {
              type: 'string',
              description: 'ID of the workspace to switch to'
            }
          },
          required: ['workspaceId']
        }
      },
      {
        name: 'list_sessions',
        description: 'List all active terminal sessions in the current workspace',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'send_to_terminal',
        description: 'Send a command or message to a specific terminal session',
        input_schema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'ID of the terminal session (e.g., work1-claude, work2-server)'
            },
            input: {
              type: 'string',
              description: 'The text to send to the terminal'
            }
          },
          required: ['sessionId', 'input']
        }
      },
      {
        name: 'get_terminal_output',
        description: 'Get recent output from a terminal session',
        input_schema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'ID of the terminal session'
            },
            lines: {
              type: 'number',
              description: 'Number of recent lines to retrieve (default: 50)'
            }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'list_ports',
        description: 'List all port assignments across sessions',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_port',
        description: 'Get an available port for a worktree',
        input_schema: {
          type: 'object',
          properties: {
            repoPath: {
              type: 'string',
              description: 'Repository path'
            },
            worktreeId: {
              type: 'string',
              description: 'Worktree ID (e.g., work1, work2)'
            }
          },
          required: ['repoPath', 'worktreeId']
        }
      },
      {
        name: 'broadcast_message',
        description: 'Send a message to all Claude terminals in the workspace',
        input_schema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to broadcast'
            }
          },
          required: ['message']
        }
      }
    ];
  }

  /**
   * Execute a tool call
   */
  async executeTool(toolName, toolInput) {
    logger.info('Executing tool', { tool: toolName, input: toolInput });

    try {
      switch (toolName) {
        case 'create_project':
          return await this.toolCreateProject(toolInput);
        case 'list_workspaces':
          return await this.toolListWorkspaces();
        case 'switch_workspace':
          return await this.toolSwitchWorkspace(toolInput);
        case 'list_sessions':
          return await this.toolListSessions();
        case 'send_to_terminal':
          return await this.toolSendToTerminal(toolInput);
        case 'get_terminal_output':
          return await this.toolGetTerminalOutput(toolInput);
        case 'list_ports':
          return await this.toolListPorts();
        case 'get_port':
          return await this.toolGetPort(toolInput);
        case 'broadcast_message':
          return await this.toolBroadcastMessage(toolInput);
        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      logger.error('Tool execution failed', { tool: toolName, error: error.message });
      return { error: error.message };
    }
  }

  // Tool implementations
  async toolCreateProject({ name, templateId, basePath, worktreeCount = 4 }) {
    if (!this.greenfieldService) {
      return { error: 'Greenfield service not available' };
    }

    const result = await this.greenfieldService.createProject({
      name,
      templateId,
      basePath,
      worktreeCount
    });

    return {
      success: true,
      projectPath: result.projectPath,
      worktrees: result.worktrees,
      message: `Created project "${name}" at ${result.projectPath} with ${worktreeCount} worktrees`
    };
  }

  async toolListWorkspaces() {
    if (!this.workspaceManager) {
      return { error: 'Workspace manager not available' };
    }

    const workspaces = await this.workspaceManager.listWorkspaces();
    return {
      workspaces: workspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        type: ws.type,
        terminals: ws.terminals?.pairs || 0
      }))
    };
  }

  async toolSwitchWorkspace({ workspaceId }) {
    if (!this.workspaceManager || !this.io) {
      return { error: 'Workspace manager or Socket.IO not available' };
    }

    // Emit workspace switch event
    this.io.emit('commander-switch-workspace', { workspaceId });

    return {
      success: true,
      message: `Switching to workspace: ${workspaceId}`
    };
  }

  async toolListSessions() {
    if (!this.sessionManager) {
      return { error: 'Session manager not available' };
    }

    const sessions = this.sessionManager.getAllSessions();
    return {
      sessions: sessions.map(s => ({
        id: s.id,
        type: s.type,
        status: s.status,
        branch: s.branch
      }))
    };
  }

  async toolSendToTerminal({ sessionId, input }) {
    if (!this.sessionManager) {
      return { error: 'Session manager not available' };
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { error: `Session not found: ${sessionId}` };
    }

    // Send input to the terminal
    this.sessionManager.sendInput(sessionId, input + '\n');

    return {
      success: true,
      message: `Sent to ${sessionId}: ${input.substring(0, 50)}${input.length > 50 ? '...' : ''}`
    };
  }

  async toolGetTerminalOutput({ sessionId, lines = 50 }) {
    if (!this.sessionManager) {
      return { error: 'Session manager not available' };
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { error: `Session not found: ${sessionId}` };
    }

    // Get recent output (if available in session buffer)
    const output = session.outputBuffer?.slice(-lines).join('\n') || 'No output buffer available';

    return {
      sessionId,
      output: output.substring(0, 5000) // Limit output size
    };
  }

  async toolListPorts() {
    if (!this.portRegistry) {
      return { error: 'Port registry not available' };
    }

    const assignments = this.portRegistry.getAllAssignments();
    return { ports: assignments };
  }

  async toolGetPort({ repoPath, worktreeId }) {
    if (!this.portRegistry) {
      return { error: 'Port registry not available' };
    }

    const port = await this.portRegistry.getOrAssignPort(repoPath, worktreeId);
    return { port, repoPath, worktreeId };
  }

  async toolBroadcastMessage({ message }) {
    if (!this.sessionManager) {
      return { error: 'Session manager not available' };
    }

    const sessions = this.sessionManager.getAllSessions();
    const claudeSessions = sessions.filter(s => s.type === 'claude');

    let sent = 0;
    for (const session of claudeSessions) {
      this.sessionManager.sendInput(session.id, message + '\n');
      sent++;
    }

    return {
      success: true,
      message: `Broadcast sent to ${sent} Claude sessions`
    };
  }

  /**
   * Process a user command through Claude
   */
  async processCommand(userInput) {
    if (!this.client) {
      // Simulate response when no API key
      return {
        response: `Commander would process: "${userInput}"\n\nNote: ANTHROPIC_API_KEY not configured. Set it in .env to enable full functionality.`,
        toolCalls: []
      };
    }

    try {
      // Add user message to history
      this.conversationHistory.push({
        role: 'user',
        content: userInput
      });

      // Call Claude API with tools
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: COMMANDER_SYSTEM_PROMPT,
        tools: this.getTools(),
        messages: this.conversationHistory
      });

      // Process response
      const toolResults = [];
      let textResponse = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          textResponse += block.text;
        } else if (block.type === 'tool_use') {
          const result = await this.executeTool(block.name, block.input);
          toolResults.push({
            tool: block.name,
            input: block.input,
            result
          });
        }
      }

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content
      });

      // If there were tool calls, send results back to Claude
      if (toolResults.length > 0) {
        this.conversationHistory.push({
          role: 'user',
          content: toolResults.map(tr => ({
            type: 'tool_result',
            tool_use_id: tr.tool,
            content: JSON.stringify(tr.result)
          }))
        });

        // Get final response after tool results
        const finalResponse = await this.client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: COMMANDER_SYSTEM_PROMPT,
          messages: this.conversationHistory
        });

        for (const block of finalResponse.content) {
          if (block.type === 'text') {
            textResponse += '\n' + block.text;
          }
        }

        this.conversationHistory.push({
          role: 'assistant',
          content: finalResponse.content
        });
      }

      return {
        response: textResponse,
        toolCalls: toolResults
      };

    } catch (error) {
      logger.error('Commander API error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
    logger.info('Commander history cleared');
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      enabled: !!this.client,
      historyLength: this.conversationHistory.length,
      apiKeyConfigured: !!this.apiKey
    };
  }
}

module.exports = { CommanderService };
