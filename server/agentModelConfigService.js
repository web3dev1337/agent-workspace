const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeProjectFolderName } = require('./utils/pathUtils');

// Claude Code re-reads these files on every launch, so a short cache keeps
// badge refreshes cheap (and dedupes the shared user-global file across sessions
// within one request) without showing stale values for long.
const FILE_CACHE_TTL_MS = 1500;

// The live model is read from the tail of the session transcript; 64 KB comfortably
// contains the most recent assistant turn even for very large (multi-MB) transcripts.
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

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
  constructor({ logger = console, homeDir = null, fsImpl = fs, processEnv = process.env } = {}) {
    this.logger = logger;
    this.homeDir = homeDir || os.homedir();
    this.fs = fsImpl;
    this.processEnv = processEnv;
    this.fileCache = new Map();
    this.liveModelCache = new Map();
  }

  static getInstance(options = {}) {
    if (!AgentModelConfigService.instance) {
      AgentModelConfigService.instance = new AgentModelConfigService(options);
    }
    return AgentModelConfigService.instance;
  }

  resolveClaudeConfig(directory, { agentRunning = false } = {}) {
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

    // Prefer the model the running session is ACTUALLY using, read from its Claude Code
    // transcript. The user can switch models mid-session with /model, which never touches
    // the settings files above — so the config-derived model can be stale/wrong (the
    // "badge says Fable but I'm actually on Opus" trap). Only consulted while a Claude
    // agent is actually running in the terminal: a closed/finished chat leaves its
    // transcript behind, and showing that as if it were live state is the same trap
    // in the other direction. Falls back to config when no transcript resolves.
    if (agentRunning) {
      const liveModel = this.resolveLiveClaudeModel(directory);
      if (liveModel) {
        resolved.model = liveModel;
        resolved.modelSource = { label: 'live session (transcript)', file: null };
      }
    }

    return resolved;
  }

  // Read the model the running Claude session is actually using, from its transcript
  // (~/.claude/projects/<encoded-cwd>/<session>.jsonl). Claude Code records the model on
  // every assistant turn, so the newest one reflects a mid-session /model switch the
  // settings files never see. Returns null (caller keeps the config model) when no
  // transcript can be resolved. Results are cached per directory with the same TTL as
  // file reads — the client polls this endpoint per session, and each uncached lookup
  // costs a readdir + a stat per historical transcript.
  resolveLiveClaudeModel(directory) {
    try {
      if (!this.isNonEmptyString(directory)) return null;
      const cwd = path.resolve(directory);
      const now = Date.now();
      const cached = this.liveModelCache.get(cwd);
      if (cached && now - cached.readAt < FILE_CACHE_TTL_MS) {
        return cached.model;
      }
      const model = this.readLiveClaudeModel(cwd);
      this.liveModelCache.set(cwd, { readAt: now, model });
      return model;
    } catch {
      return null;
    }
  }

  readLiveClaudeModel(cwd) {
    const projectDir = path.join(this.homeDir, '.claude', 'projects', this.encodeClaudeProjectDir(cwd));
    let names;
    try {
      names = this.fs.readdirSync(projectDir);
    } catch {
      return null;
    }
    const newest = names
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => {
        const file = path.join(projectDir, name);
        let mtimeMs = 0;
        try { mtimeMs = this.fs.statSync(file).mtimeMs; } catch { /* skip unreadable */ }
        return { file, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!newest) return null;
    return this.readLastModelFromTranscript(newest.file);
  }

  // Claude Code names each project's transcript folder by sanitizing the absolute cwd;
  // delegates to the shared implementation used by session recovery.
  encodeClaudeProjectDir(cwd) {
    return claudeProjectFolderName(cwd);
  }

  // Return the most recent real model id from a transcript, reading only its tail so
  // multi-MB files stay cheap. Parses whole JSONL lines and only accepts the top-level
  // message.model of assistant turns — a substring scan would also match "model" keys
  // inside message CONTENT (tool params, quoted JSON in code discussions) and show a
  // wrong-but-authoritative-looking model. Skips synthetic placeholders ("<synthetic>").
  readLastModelFromTranscript(file) {
    let fd;
    try {
      fd = this.fs.openSync(file, 'r');
      const size = this.fs.fstatSync(fd).size;
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      if (length <= 0) return null;
      const buffer = Buffer.alloc(length);
      this.fs.readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split('\n');
      // Walk newest-first; a truncated first line of the tail simply fails to parse.
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (!parsed || parsed.type !== 'assistant') continue;
        const model = typeof parsed.message?.model === 'string' ? parsed.message.model.trim() : '';
        if (model && !model.startsWith('<')) return model;
      }
      return null;
    } catch {
      return null;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch { /* ignore */ }
      }
    }
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

    if (this.isNonEmptyString(this.processEnv[name])) {
      return {
        value: this.processEnv[name].trim(),
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
