const { listPresets, applyPreset, buildPresetVisibility } = require('../../server/visibilityPresetService');

describe('visibilityPresetService', () => {
  test('lists both presets', () => {
    const presets = listPresets();
    expect(presets.map(p => p.id).sort()).toEqual(['power', 'simple']);
  });

  test('simple preset mirrors shipped defaults (workflow layer hidden)', () => {
    const vis = buildPresetVisibility('simple');
    expect(vis.header.workflowMode).toBe(false);
    expect(vis.header.prs).toBe(false);
    expect(vis.processBanner).toBe(false);
  });

  test('power preset enables the workflow layer without touching unrelated flags', () => {
    const vis = buildPresetVisibility('power');
    expect(vis.header.workflowMode).toBe(true);
    expect(vis.header.tierFilters).toBe(true);
    expect(vis.header.queue).toBe(true);
    expect(vis.dashboard.processSection).toBe(true);
    expect(vis.commander.advice).toBe(true);
    // intentHints stays opt-in (may call a model API)
    expect(vis.terminal.intentHints).toBe(false);
    // unrelated defaults survive the merge
    expect(vis.terminal.removeWorktree).toBe(true);
  });

  test('applyPreset persists visibility + preset name via userSettingsService', () => {
    const saved = {};
    const fakeSettings = {
      getAllSettings: () => ({ global: { ui: { existing: 'kept' } } }),
      updateGlobalSettings: (global) => { saved.global = global; return true; }
    };

    const result = applyPreset(fakeSettings, 'power');
    expect(result.preset).toBe('power');
    expect(saved.global.ui.visibilityPreset).toBe('power');
    expect(saved.global.ui.visibility.header.workflowMode).toBe(true);
    expect(saved.global.ui.existing).toBe('kept');
  });

  test('rejects unknown presets', () => {
    expect(() => applyPreset({ getAllSettings: () => ({}), updateGlobalSettings: () => true }, 'nope'))
      .toThrow(/Unknown visibility preset/);
  });
});
