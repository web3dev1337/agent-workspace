const { PolicyService } = require('../../server/policyService');
const { PolicyBundleService } = require('../../server/policyBundleService');

function createServices(initialPolicy = {}) {
  const state = {
    global: {
      policy: { ...initialPolicy }
    }
  };
  const userSettingsService = {
    getAllSettings: () => state,
    updateGlobalSettings: (patch = {}) => {
      state.global = state.global || {};
      state.global.policy = { ...(state.global.policy || {}), ...(patch.policy || {}) };
      return true;
    }
  };
  const policyService = new PolicyService();
  policyService.init({ userSettingsService, commandRegistry: { getCommand: () => null } });
  const policyBundleService = new PolicyBundleService({ policyService, userSettingsService });
  return { state, policyService, policyBundleService };
}

describe('PolicyBundleService', () => {
  test('lists built-in templates', () => {
    const { policyBundleService } = createServices();
    const templates = policyBundleService.listTemplates();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(2);
    expect(templates.some((entry) => entry.id === 'team-balanced')).toBe(true);
  });

  test('exports policy bundle from template', () => {
    const { policyBundleService } = createServices();
    const bundle = policyBundleService.exportBundle({
      templateId: 'strict-compliance',
      orgName: 'ACME',
      createdBy: 'operator'
    });
    expect(bundle.kind).toBe('orchestrator-policy-bundle');
    expect(bundle.metadata.templateId).toBe('strict-compliance');
    expect(bundle.metadata.orgName).toBe('ACME');
    expect(bundle.policy.enabled).toBe(true);
    expect(bundle.policy.roleByAction.destructive).toBe('admin');
  });

  test('imports policy bundle in replace mode', () => {
    const { state, policyBundleService } = createServices({ enabled: false, defaultRole: 'admin' });
    const bundle = policyBundleService.exportBundle({ templateId: 'team-balanced' });
    const result = policyBundleService.importBundle(bundle, { mode: 'replace' });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('replace');
    expect(state.global.policy.enabled).toBe(true);
    expect(state.global.policy.defaultRole).toBe('operator');
  });

  test('imports policy bundle in merge mode', () => {
    const { state, policyBundleService } = createServices({
      enabled: true,
      defaultRole: 'admin',
      roleByAction: {
        read: 'viewer',
        write: 'operator',
        destructive: 'admin',
        billing: 'admin',
        audit_export: 'operator',
        command_execute: 'admin'
      }
    });
    const bundle = policyBundleService.exportBundle({
      policy: {
        enabled: true,
        defaultRole: 'viewer',
        roleByAction: {
          command_execute: 'operator'
        }
      }
    });
    const result = policyBundleService.importBundle(bundle, { mode: 'merge' });
    expect(result.ok).toBe(true);
    expect(state.global.policy.defaultRole).toBe('viewer');
    expect(state.global.policy.roleByAction.command_execute).toBe('operator');
    expect(state.global.policy.roleByAction.destructive).toBe('admin');
  });
});
