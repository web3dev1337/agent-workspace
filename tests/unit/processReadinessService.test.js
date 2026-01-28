const { ProcessReadinessService } = require('../../server/processReadinessService');

describe('ProcessReadinessService', () => {
  test('returns default checklist templates', () => {
    const svc = new ProcessReadinessService();
    const data = svc.getTemplates();
    const templates = Array.isArray(data?.templates) ? data.templates : [];
    const ids = templates.map(t => String(t?.id || '').trim()).filter(Boolean);
    expect(ids).toEqual(expect.arrayContaining(['playtest', 'launch', 'domain', 'hosting', 'security']));
    expect(templates.every(t => Array.isArray(t.items) && t.items.length > 0)).toBe(true);
  });
});

