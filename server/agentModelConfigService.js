const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Code re-reads these files on every launch, so a short cache keeps
// badge refreshes cheap (and dedupes the shared user-global file across sessions
// within one request) without showing stale values for long.
const FILE_CACHE_TTL_MS = 1500;

// Claude Code settings precedence (highest first) for the keys we care about:
// CLI args > .claude/settings.local.json > .claude/settings.json > ~/.claude/settings.json
// https://code.claude.com/docs/en/settings
const CLAUDE_WORKTREE_LAYERS = [
  { label: 'local settings', segments: ['.claude', 'settings.local.json'] },
  { label: 'project settings', segments: ['.claude', 'settings.json'] }
];
const CLAUDE_USER_LAYER_LABEL = 'user settings (global)';
const CODEX_CONFIG_LABEL = 'codex config (global)';

class AgentModelConfigService {
  constructor({ logger = console, homeDir = null, fsImpl = fs } = {}) {
    this.logger = logger;
    this.homeDir = homeDir || os.homedir();
    this.fs = fsImpl;
    this.fileCache = new Map();
  }

  static getInstance(options = {}) {
    if (!AgentModelConfigService.instance) {
      AgentModelConfigService.instance = new AgentModelConfigService(options);
    }
    return AgentModelConfigService.instance;
  }

  resolveClaudeConfig(directory) {
    const resolved = {
      agent: 'claude',
      model: null,
      effortLevel: null,
      modelSource: null,
      effortSource: null
    };

    for (const layer of this.getClaudeSettingsLayers(directory)) {
      const settings = this.readJsonFile(layer.file);
      if (!settings) continue;
      if (!resolved.model && this.isNonEmptyString(settings.model)) {
        resolved.model = settings.model.trim();
        resolved.modelSource = { label: layer.label, file: layer.file };
      }
      if (!resolved.effortLevel && this.isNonEmptyString(settings.effortLevel)) {
        resolved.effortLevel = settings.effortLevel.trim().toLowerCase();
        resolved.effortSource = { label: layer.label, file: layer.file };
      }
      if (resolved.model && resolved.effortLevel) break;
    }

    return resolved;
  }

  resolveCodexConfig() {
    const file = path.join(this.homeDir, '.codex', 'config.toml');
    const resolved = {
      agent: 'codex',
      model: null,
      effortLevel: null,
      modelSource: null,
      effortSource: null
    };

    const raw = this.readTextFile(file);
    if (!raw) return resolved;

    const model = this.readTopLevelTomlString(raw, 'model');
    if (model) {
      resolved.model = model;
      resolved.modelSource = { label: CODEX_CONFIG_LABEL, file };
    }
    const effort = this.readTopLevelTomlString(raw, 'model_reasoning_effort');
    if (effort) {
      resolved.effortLevel = effort.toLowerCase();
      resolved.effortSource = { label: CODEX_CONFIG_LABEL, file };
    }

    return resolved;
  }

  getClaudeSettingsLayers(directory) {
    const layers = [];
    const dir = String(directory || '').trim();
    if (dir) {
      for (const layer of CLAUDE_WORKTREE_LAYERS) {
        layers.push({ label: layer.label, file: path.join(dir, ...layer.segments) });
      }
    }
    layers.push({
      label: CLAUDE_USER_LAYER_LABEL,
      file: path.join(this.homeDir, '.claude', 'settings.json')
    });
    return layers;
  }

  // Minimal TOML lookup: only string keys above the first [section] header,
  // which is where Codex keeps `model` and `model_reasoning_effort`.
  readTopLevelTomlString(raw, key) {
    for (const line of String(raw).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) break;
      const match = trimmed.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`));
      if (match) return match[1].trim() || null;
    }
    return null;
  }

  readJsonFile(file) {
    const raw = this.readTextFile(file);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      this.logger.debug?.('Ignoring unparseable agent settings file', { file, error: error.message });
      return null;
    }
  }

  readTextFile(file) {
    const now = Date.now();
    const cached = this.fileCache.get(file);
    if (cached && (now - cached.readAt) < FILE_CACHE_TTL_MS) {
      return cached.content;
    }
    let content = null;
    try {
      content = this.fs.readFileSync(file, 'utf8');
    } catch {
      content = null;
    }
    this.fileCache.set(file, { readAt: now, content });
    return content;
  }

  isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }
}

module.exports = { AgentModelConfigService };
