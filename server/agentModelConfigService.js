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

// Model aliases Claude Code resolves through ANTHROPIC_DEFAULT_*_MODEL env vars
// (settable in any settings layer's `env` block, ~/.claude/.env, or the server
// environment the PTY inherits). `opusplan` plans on Opus, so it maps there too.
const CLAUDE_MODEL_ALIAS_ENV = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  opusplan: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL'
};
const CLAUDE_EFFORT_ENV = 'CLAUDE_CODE_EFFORT_LEVEL';
const CLAUDE_MODEL_ENV = 'ANTHROPIC_MODEL';

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

    const layers = this.getClaudeSettingsLayers(directory).map((layer) => ({
      ...layer,
      settings: this.readJsonFile(layer.file)
    }));

    for (const layer of layers) {
      if (!layer.settings) continue;
      if (!resolved.model && this.isNonEmptyString(layer.settings.model)) {
        resolved.model = layer.settings.model.trim();
        resolved.modelSource = { label: layer.label, file: layer.file };
      }
      if (!resolved.effortLevel && this.isNonEmptyString(layer.settings.effortLevel)) {
        resolved.effortLevel = layer.settings.effortLevel.trim().toLowerCase();
        resolved.effortSource = { label: layer.label, file: layer.file };
      }
    }

    // Env overrides. ANTHROPIC_MODEL fills in when no `model` key is set; the
    // CLAUDE_CODE_EFFORT_LEVEL env var overrides the `effortLevel` key.
    if (!resolved.model) {
      const envModel = this.resolveClaudeEnvVar(layers, CLAUDE_MODEL_ENV);
      if (envModel) {
        resolved.model = envModel.value;
        resolved.modelSource = envModel.source;
      }
    }
    const envEffort = this.resolveClaudeEnvVar(layers, CLAUDE_EFFORT_ENV);
    if (envEffort) {
      resolved.effortLevel = envEffort.value.toLowerCase();
      resolved.effortSource = envEffort.source;
    }

    // Aliases (opus/sonnet/haiku/opusplan) launch whatever the matching
    // ANTHROPIC_DEFAULT_*_MODEL env var points at — show that real model.
    const aliasEnvName = CLAUDE_MODEL_ALIAS_ENV[String(resolved.model || '').toLowerCase()];
    if (aliasEnvName) {
      const aliasTarget = this.resolveClaudeEnvVar(layers, aliasEnvName);
      if (aliasTarget) {
        resolved.model = aliasTarget.value;
        resolved.modelSource = {
          label: `${aliasEnvName} via ${aliasTarget.source.label}`,
          file: aliasTarget.source.file
        };
      }
    }

    return resolved;
  }

  // Look an env var up the way a launched agent would see it: settings-layer
  // `env` blocks (local > project > user), then ~/.claude/.env (sourced by the
  // user's shell profile), then the server environment the PTY inherits.
  resolveClaudeEnvVar(layers, name) {
    for (const layer of layers) {
      const env = layer.settings?.env;
      const value = env && typeof env === 'object' ? env[name] : undefined;
      if (this.isNonEmptyString(value)) {
        return {
          value: value.trim(),
          source: { label: `env block (${layer.label})`, file: layer.file }
        };
      }
    }

    const envFile = path.join(this.homeDir, '.claude', '.env');
    const fromEnvFile = this.readDotEnvValue(envFile, name);
    if (this.isNonEmptyString(fromEnvFile)) {
      return {
        value: fromEnvFile.trim(),
        source: { label: 'env file', file: envFile }
      };
    }

    if (this.isNonEmptyString(process.env[name])) {
      return {
        value: process.env[name].trim(),
        source: { label: 'server environment', file: null }
      };
    }

    return null;
  }

  // Minimal dotenv lookup: KEY=VALUE lines, optional `export `, quotes stripped.
  readDotEnvValue(file, key) {
    const raw = this.readTextFile(file);
    if (!raw) return null;
    for (const line of String(raw).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || match[1] !== key) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value || null;
    }
    return null;
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
