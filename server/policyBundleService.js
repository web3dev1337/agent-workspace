class PolicyBundleService {
  constructor({ policyService, userSettingsService } = {}) {
    this.policyService = policyService;
    this.userSettingsService = userSettingsService;
  }

  static getInstance(deps = {}) {
    if (!PolicyBundleService.instance) {
      PolicyBundleService.instance = new PolicyBundleService(deps);
    }
    return PolicyBundleService.instance;
  }

  normalizeRole(role) {
    const value = String(role || '').trim().toLowerCase();
    if (value === 'viewer' || value === 'operator' || value === 'admin' || value === 'system') return value;
    return 'viewer';
  }

  getTemplateMap() {
    return {
      'team-balanced': {
        id: 'team-balanced',
        name: 'Team Balanced',
        description: 'Balanced role gating for mixed engineering teams.',
        policy: {
          enabled: true,
          defaultRole: 'operator',
          allowHeaderOverride: true,
          headerName: 'x-orchestrator-role',
          allowQueryOverride: false,
          queryName: 'role',
          roleByAction: {
            read: 'viewer',
            write: 'operator',
            destructive: 'admin',
            billing: 'admin',
            audit_export: 'operator',
            command_execute: 'operator'
          }
        }
      },
      'review-heavy': {
        id: 'review-heavy',
        name: 'Review Heavy',
        description: 'Optimized for review-oriented teams with stricter merge controls.',
        policy: {
          enabled: true,
          defaultRole: 'viewer',
          allowHeaderOverride: true,
          headerName: 'x-orchestrator-role',
          allowQueryOverride: false,
          queryName: 'role',
          roleByAction: {
            read: 'viewer',
            write: 'operator',
            destructive: 'admin',
            billing: 'admin',
            audit_export: 'operator',
            command_execute: 'operator'
          },
          dangerousCommandPatterns: [
            'merge',
            'approve',
            'request-changes',
            'request_changes',
            'remove',
            'destroy',
            'kill',
            'stop',
            'restart',
            'close',
            'ticket-move',
            'start-agent'
          ]
        }
      },
      'strict-compliance': {
        id: 'strict-compliance',
        name: 'Strict Compliance',
        description: 'Strong controls for regulated teams and audit-heavy workflows.',
        policy: {
          enabled: true,
          defaultRole: 'viewer',
          allowHeaderOverride: false,
          headerName: 'x-orchestrator-role',
          allowQueryOverride: false,
          queryName: 'role',
          roleByAction: {
            read: 'viewer',
            write: 'admin',
            destructive: 'admin',
            billing: 'admin',
            audit_export: 'admin',
            command_execute: 'admin'
          }
        }
      },
      'single-operator-local': {
        id: 'single-operator-local',
        name: 'Single Operator (Local)',
        description: 'Low-friction local mode for solo operators.',
        policy: {
          enabled: false,
          defaultRole: 'admin',
          allowHeaderOverride: false,
          allowQueryOverride: false
        }
      }
    };
  }

  listTemplates() {
    const map = this.getTemplateMap();
    return Object.values(map).map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      policy: template.policy
    }));
  }

  getTemplate(templateId) {
    const key = String(templateId || '').trim();
    const hit = this.getTemplateMap()[key] || null;
    return hit ? JSON.parse(JSON.stringify(hit)) : null;
  }

  sanitizePolicy(policy) {
    const base = this.policyService?.getDefaultConfig?.() || {};
    const next = policy && typeof policy === 'object' ? policy : {};

    const sanitizeRoleMap = (raw) => {
      const out = {};
      const source = raw && typeof raw === 'object' ? raw : {};
      for (const [key, value] of Object.entries(source)) {
        out[key] = this.normalizeRole(value);
      }
      return out;
    };

    return {
      ...base,
      ...next,
      enabled: next.enabled === true,
      defaultRole: this.normalizeRole(next.defaultRole || base.defaultRole),
      allowHeaderOverride: next.allowHeaderOverride === true,
      headerName: String(next.headerName || base.headerName || 'x-orchestrator-role').trim() || 'x-orchestrator-role',
      allowQueryOverride: next.allowQueryOverride === true,
      queryName: String(next.queryName || base.queryName || 'role').trim() || 'role',
      roleByAction: {
        ...(base.roleByAction || {}),
        ...sanitizeRoleMap(next.roleByAction)
      },
      dangerousCommandPatterns: Array.isArray(next.dangerousCommandPatterns)
        ? next.dangerousCommandPatterns.map((value) => String(value || '').trim()).filter(Boolean)
        : (base.dangerousCommandPatterns || []),
      readOnlyCommandPatterns: Array.isArray(next.readOnlyCommandPatterns)
        ? next.readOnlyCommandPatterns.map((value) => String(value || '').trim()).filter(Boolean)
        : (base.readOnlyCommandPatterns || [])
    };
  }

  buildBundle({
    templateId = '',
    policy = null,
    orgName = '',
    notes = '',
    createdBy = ''
  } = {}) {
    const template = templateId ? this.getTemplate(templateId) : null;
    if (templateId && !template) {
      throw new Error(`Unknown policy template: ${templateId}`);
    }

    const sourcePolicy = policy || template?.policy || this.policyService?.getConfig?.() || {};
    const normalizedPolicy = this.sanitizePolicy(sourcePolicy);
    const timestamp = new Date().toISOString();

    return {
      schemaVersion: 1,
      kind: 'orchestrator-policy-bundle',
      createdAt: timestamp,
      metadata: {
        templateId: template?.id || null,
        templateName: template?.name || null,
        orgName: String(orgName || '').trim() || null,
        notes: String(notes || '').trim() || null,
        createdBy: String(createdBy || '').trim() || null
      },
      policy: normalizedPolicy
    };
  }

  exportBundle(options = {}) {
    return this.buildBundle(options);
  }

  importBundle(bundle, { mode = 'replace' } = {}) {
    if (!bundle || typeof bundle !== 'object') {
      throw new Error('Bundle payload must be an object');
    }

    const kind = String(bundle.kind || '').trim();
    if (kind !== 'orchestrator-policy-bundle') {
      throw new Error('Invalid policy bundle kind');
    }

    const incomingPolicy = this.sanitizePolicy(bundle.policy || {});
    const currentPolicy = this.policyService?.getConfig?.() || this.policyService?.getDefaultConfig?.() || {};
    const normalizedMode = String(mode || 'replace').trim().toLowerCase();

    const appliedPolicy = normalizedMode === 'merge'
      ? this.sanitizePolicy({
        ...currentPolicy,
        ...incomingPolicy,
        roleByAction: {
          ...(currentPolicy.roleByAction || {}),
          ...(incomingPolicy.roleByAction || {})
        }
      })
      : incomingPolicy;

    const ok = this.userSettingsService?.updateGlobalSettings?.({ policy: appliedPolicy }) === true;
    if (!ok) throw new Error('Failed to persist policy settings');

    return {
      ok: true,
      mode: normalizedMode === 'merge' ? 'merge' : 'replace',
      appliedPolicy
    };
  }
}

module.exports = { PolicyBundleService };
