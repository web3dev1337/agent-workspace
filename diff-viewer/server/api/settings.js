const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const repoRoot = path.join(__dirname, '..', '..', '..');
const userSettingsPath = path.join(repoRoot, 'user-settings.json');
const defaultSettingsPath = path.join(repoRoot, 'user-settings.default.json');

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  Object.entries(override).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  });
  return out;
}

function loadMergedSettings() {
  const defaults = readJsonIfExists(defaultSettingsPath) || {};
  const user = readJsonIfExists(userSettingsPath) || {};
  return deepMerge(defaults, user);
}

function getDiffViewerTheme(settings) {
  const theme = settings?.global?.ui?.diffViewer?.theme;
  if (theme === 'dark' || theme === 'light') return theme;
  return 'light';
}

router.get('/', (req, res) => {
  const settings = loadMergedSettings();
  res.json({
    diffViewer: {
      theme: getDiffViewerTheme(settings)
    }
  });
});

router.put('/diff-viewer-theme', (req, res) => {
  const theme = String(req.body?.theme || '').toLowerCase();
  if (theme !== 'dark' && theme !== 'light') {
    return res.status(400).json({ error: 'theme must be light|dark' });
  }

  const current = readJsonIfExists(userSettingsPath) || {};
  const next = deepMerge(current, {
    global: {
      ui: {
        diffViewer: {
          theme
        }
      }
    }
  });

  try {
    fs.writeFileSync(userSettingsPath, JSON.stringify(next, null, 2));
    res.json({ ok: true, diffViewer: { theme } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings', message: error.message });
  }
});

module.exports = router;

