const commandRegistry = require('../../server/commandRegistry');

describe('CommandRegistry catalog metadata', () => {
  beforeAll(() => {
    commandRegistry.init({
      io: { emit: jest.fn() },
      sessionManager: {
        sessions: new Map(),
        getSessionById: () => null,
        writeToSession: () => false
      },
      workspaceManager: {
        listWorkspaces: async () => []
      }
    });
  });

  test('getCatalog returns flat commands with metadata', () => {
    const catalog = commandRegistry.getCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);

    const listSessions = catalog.find((cmd) => cmd.name === 'list-sessions');
    expect(listSessions).toBeTruthy();
    expect(listSessions.category).toBe('sessions');
    expect(listSessions.safetyLevel).toBe('safe');
    expect(Array.isArray(listSessions.surfaces)).toBe(true);
    expect(listSessions.surfaces).toContain('voice');
    expect(listSessions.surfaces).toContain('commander');
  });

  test('getCapabilities keeps grouped shape and includes metadata', () => {
    const capabilities = commandRegistry.getCapabilities();
    expect(capabilities).toBeTruthy();
    expect(Array.isArray(capabilities.sessions)).toBe(true);
    expect(capabilities.sessions.length).toBeGreaterThan(0);

    const first = capabilities.sessions[0];
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('description');
    expect(first).toHaveProperty('safetyLevel');
    expect(first).toHaveProperty('surfaces');
  });
});

