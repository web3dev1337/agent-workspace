const fs = require('fs');
const os = require('os');
const path = require('path');

const AgentManager = require('../../server/agentManager');
const { spawnAgentInSession } = require('../../server/agentSpawnHelper');

const writeCustomAgents = (agents) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-agents-'));
  const filePath = path.join(tmp, 'custom-agents.json');
  fs.writeFileSync(filePath, JSON.stringify({ agents }));
  return filePath;
};

const GEMINI_LIKE = {
  name: 'Gemini CLI',
  baseCommand: 'gemini',
  flags: {
    yolo: { flag: '--yolo', label: 'YOLO', default: true }
  },
  defaultFlags: ['yolo'],
  modelFlag: '-m {model}',
  reasoningFlag: '--effort {reasoning}',
  initDelayMs: 12000
};

describe('AgentManager custom agents', () => {
  test('registers a custom agent from the config file', () => {
    const manager = new AgentManager({ customAgentsPath: writeCustomAgents({ gemini: GEMINI_LIKE }) });

    const agent = manager.getAgent('gemini');
    expect(agent).toBeTruthy();
    expect(agent.custom).toBe(true);
    expect(agent.modes.fresh.command).toBe('gemini');
    expect(manager.getSpawnFlags('gemini')).toEqual(['yolo']);
    expect(manager.getInitDelayMs('gemini')).toBe(12000);
    // Built-ins survive alongside
    expect(manager.getAgent('claude')).toBeTruthy();
    expect(manager.getAgent('codex')).toBeTruthy();
  });

  test('buildCommand uses per-agent model/reasoning flag templates', () => {
    const manager = new AgentManager({ customAgentsPath: writeCustomAgents({ gemini: GEMINI_LIKE }) });

    const command = manager.buildCommand('gemini', 'fresh', {
      agentId: 'gemini',
      flags: ['yolo'],
      model: 'gemini-2.5-pro',
      reasoning: 'high'
    });

    expect(command).toBe('gemini -m gemini-2.5-pro --effort high --yolo');
  });

  test('codex keeps its default -m / -c reasoning syntax', () => {
    const manager = new AgentManager({ customAgentsPath: null });
    const command = manager.buildCommand('codex', 'fresh', {
      agentId: 'codex',
      flags: ['yolo'],
      model: 'gpt-5.5',
      reasoning: 'high'
    });
    expect(command).toContain('-m gpt-5.5');
    expect(command).toContain('-c model_reasoning_effort="high"');
    expect(command).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  test('reasoning is not appended for agents without reasoning support', () => {
    const manager = new AgentManager({
      customAgentsPath: writeCustomAgents({
        plain: { baseCommand: 'plain-cli', modelFlag: '--model {model}' }
      })
    });
    const command = manager.buildCommand('plain', 'fresh', {
      agentId: 'plain',
      flags: [],
      model: 'x-1',
      reasoning: 'high'
    });
    expect(command).toBe('plain-cli --model x-1');
  });

  test('cannot silently override built-ins without override flag', () => {
    const manager = new AgentManager({
      customAgentsPath: writeCustomAgents({
        claude: { baseCommand: 'evil-claude' }
      })
    });
    expect(manager.getAgent('claude').baseCommand).toBe('claude');
  });

  test('validateConfig accepts custom agents and rejects unknown flags', () => {
    const manager = new AgentManager({ customAgentsPath: writeCustomAgents({ gemini: GEMINI_LIKE }) });
    expect(manager.validateConfig({ agentId: 'gemini', mode: 'fresh', flags: ['yolo'] }).valid).toBe(true);
    expect(manager.validateConfig({ agentId: 'gemini', mode: 'fresh', flags: ['nope'] }).valid).toBe(false);
  });
});

describe('spawnAgentInSession registry-driven behavior', () => {
  test('uses the registry defaultFlags and init delay for custom agents', () => {
    jest.useFakeTimers();
    const manager = new AgentManager({ customAgentsPath: writeCustomAgents({ gemini: GEMINI_LIKE }) });

    const starts = [];
    const writes = [];
    const sessionManager = {
      agentManager: manager,
      startAgentWithConfig: (sessionId, config) => { starts.push({ sessionId, config }); return true; },
      writeToSession: (sessionId, data) => writes.push(data)
    };

    const ok = spawnAgentInSession({
      sessionManager,
      sessionId: 'repo-work1-claude',
      agentId: 'gemini',
      model: 'gemini-2.5-flash',
      effort: 'low',
      prompt: 'review this'
    });

    expect(ok.started).toBe(true);
    expect(starts[0].config).toEqual({
      agentId: 'gemini',
      mode: 'fresh',
      flags: ['yolo'],
      model: 'gemini-2.5-flash',
      reasoning: 'low'
    });

    jest.advanceTimersByTime(11_999);
    expect(writes).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(writes[0]).toBe('review this');
    jest.useRealTimers();
  });

  test('cancelPendingPrompt stops the delayed prompt injection', () => {
    jest.useFakeTimers();
    const manager = new AgentManager({ customAgentsPath: writeCustomAgents({ gemini: GEMINI_LIKE }) });

    const writes = [];
    const sessionManager = {
      agentManager: manager,
      startAgentWithConfig: () => true,
      writeToSession: (sessionId, data) => writes.push(data)
    };

    const spawned = spawnAgentInSession({
      sessionManager,
      sessionId: 'repo-work1-claude',
      agentId: 'gemini',
      prompt: 'review this'
    });
    expect(spawned.started).toBe(true);

    spawned.cancelPendingPrompt();
    jest.advanceTimersByTime(60_000);
    expect(writes).toHaveLength(0);
    jest.useRealTimers();
  });
});
