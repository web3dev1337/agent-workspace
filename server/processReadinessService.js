class ProcessReadinessService {
  constructor() {}

  static getInstance() {
    if (!ProcessReadinessService.instance) {
      ProcessReadinessService.instance = new ProcessReadinessService();
    }
    return ProcessReadinessService.instance;
  }

  getTemplates() {
    return {
      generatedAt: new Date().toISOString(),
      templates: [
        {
          id: 'playtest',
          title: 'Playtest',
          items: [
            'Smoke test core loop (start → play → quit)',
            'Validate controls/input mappings',
            'Check performance/stutters in a representative scene',
            'Verify save/load or persistence flows (if applicable)',
            'Verify multiplayer/session join/leave flows (if applicable)',
            'Run a quick regression pass on recently touched features'
          ]
        },
        {
          id: 'launch',
          title: 'Launch',
          items: [
            'Confirm versioning and release notes',
            'Confirm build pipeline is green (CI, packaging, deploy)',
            'Confirm deploy plan and rollback plan',
            'Check error reporting / monitoring',
            'Verify required config/secrets are present in target env',
            'Verify links/docs and support contact are up to date'
          ]
        },
        {
          id: 'domain',
          title: 'Domain',
          items: [
            'Confirm domain ownership and registrar access',
            'DNS records: A/AAAA, CNAME, and TTLs are correct',
            'HTTPS/SSL is configured and renewing',
            'Redirects (www/non-www) are correct',
            'Custom email records (SPF/DKIM/DMARC) if needed'
          ]
        },
        {
          id: 'hosting',
          title: 'Hosting',
          items: [
            'Capacity/scaling plan (limits, autoscaling, quotas)',
            'Backups + restore procedure documented',
            'Secrets management and rotation plan',
            'Staging environment parity check',
            'Log retention and access controls'
          ]
        },
        {
          id: 'security',
          title: 'Security',
          items: [
            'Dependency audit (known vulns) / update critical deps',
            'Confirm auth/session flows (if applicable)',
            'Rate limiting / abuse controls (where applicable)',
            'Secrets scan (no keys/tokens committed)',
            'Least-privilege permissions for deploy/runtime identities'
          ]
        }
      ]
    };
  }
}

module.exports = { ProcessReadinessService };

