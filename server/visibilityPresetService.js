'use strict';

const fs = require('fs');
const path = require('path');

// Visibility presets: one-click switch between the lean open-source default
// UI ("simple") and the full process/workflow layer ("power") that was
// hidden for the public release. Individual flags can still be hand-edited
// in user-settings.json afterwards — a preset just rewrites ui.visibility.

const DEFAULTS_PATH = path.join(__dirname, '..', 'user-settings.default.json');

// Flags the "power" preset turns ON relative to the shipped defaults.
const POWER_OVERRIDES = {
  processBanner: true,
  header: {
    prs: true,
    queue: true,
    reviewRoute: true,
    activity: true,
    diff: true,
    commands: true,
    workflowMode: true,
    workflowBackground: true,
    tierFilters: true,
    focusTier2: true,
    focusSwap: true,
    history: true
  },
  sidebar: {
    viewPresets: true,
    readyForReview: true,
    sessionVisibilityToggles: true
  },
  terminal: {
    intentHints: false // opt-in separately: calls a model API
  },
  dashboard: {
    processBanner: true,
    processSection: true,
    statusCard: true,
    telemetryCard: true,
    projectsCard: true,
    adviceCard: true,
    readinessCard: true,
    quickLinks: true
  },
  commander: {
    advice: true,
    cmdMode: true,
    modeSelect: true,
    startStop: true,
    startClaude: true
  }
};

const deepMerge = (base, override) => {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return { ...override };
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = deepMerge(base[k], v);
  }
  return out;
};

const readDefaultVisibility = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    const vis = parsed?.global?.ui?.visibility;
    return vis && typeof vis === 'object' ? vis : {};
  } catch {
    return {};
  }
};

const PRESETS = {
  simple: {
    label: 'Simple',
    description: 'Lean default UI. Queue-driven review, workflow controls hidden.'
  },
  power: {
    label: 'Power / Process',
    description: 'Full workflow layer: process banner, workflow modes, tier filters, PRs, review route, activity, diff, dashboard process cards, commander controls.'
  }
};

const buildPresetVisibility = (preset) => {
  const defaults = readDefaultVisibility();
  if (preset === 'power') return deepMerge(defaults, POWER_OVERRIDES);
  return defaults;
};

const listPresets = () => Object.entries(PRESETS).map(([id, p]) => ({ id, ...p }));

const applyPreset = (userSettingsService, preset) => {
  if (!PRESETS[preset]) {
    throw new Error(`Unknown visibility preset: ${preset}. Valid: ${Object.keys(PRESETS).join(', ')}`);
  }
  const settings = userSettingsService.getAllSettings() || {};
  const global = settings.global || {};
  const ui = global.ui || {};
  ui.visibility = buildPresetVisibility(preset);
  ui.visibilityPreset = preset;
  global.ui = ui;
  const ok = userSettingsService.updateGlobalSettings(global);
  if (!ok) throw new Error('Failed to persist visibility preset');
  return { preset, visibility: ui.visibility };
};

module.exports = { listPresets, applyPreset, buildPresetVisibility, POWER_OVERRIDES };
