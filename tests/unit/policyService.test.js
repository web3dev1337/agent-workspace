const { PolicyService } = require('../../server/policyService');

function makeService(policyConfig, commandMap = {}) {
  const service = new PolicyService();
  service.init({
    userSettingsService: {
      getAllSettings: () => ({
        global: {
          policy: policyConfig || {}
        }
      })
    },
    commandRegistry: {
      getCommand: (name) => commandMap[name] || null
    }
  });
  return service;
}

describe('PolicyService', () => {
  test('allows all actions when policy is disabled', () => {
    const service = makeService({ enabled: false });
    const decision = service.canAccessAction({ action: 'destructive', req: {} });
    expect(decision.ok).toBe(true);
    expect(decision.policyEnabled).toBe(false);
  });

  test('enforces role requirement for destructive actions', () => {
    const service = makeService({
      enabled: true,
      defaultRole: 'operator'
    });
    const decision = service.canAccessAction({ action: 'destructive', req: {} });
    expect(decision.ok).toBe(false);
    expect(decision.requiredRole).toBe('admin');
    expect(decision.role).toBe('operator');
  });

  test('supports request role override via header when enabled', () => {
    const service = makeService({
      enabled: true,
      defaultRole: 'admin',
      allowHeaderOverride: true,
      headerName: 'x-orchestrator-role'
    });
    const resolved = service.resolveRole({ headers: { 'x-orchestrator-role': 'viewer' }, query: {} });
    expect(resolved.role).toBe('viewer');
    expect(resolved.source).toBe('header');
  });

  test('blocks dangerous command for operator role', () => {
    const service = makeService(
      {
        enabled: true,
        defaultRole: 'operator'
      },
      {
        'queue-merge': { safetyLevel: 'safe' }
      }
    );

    const decision = service.authorizeCommand({
      req: {},
      commandName: 'queue-merge'
    });
    expect(decision.ok).toBe(false);
    expect(decision.requiredRole).toBe('admin');
  });

  test('allows read-only command for viewer role', () => {
    const service = makeService(
      {
        enabled: true,
        defaultRole: 'viewer',
        roleByAction: { command_execute: 'viewer' }
      },
      {
        'list-sessions': { safetyLevel: 'safe' }
      }
    );

    const decision = service.authorizeCommand({
      req: {},
      commandName: 'list-sessions'
    });
    expect(decision.ok).toBe(true);
    expect(decision.requiredRole).toBe('viewer');
  });
});
