const fs = require('fs');
const os = require('os');
const path = require('path');
const { getAgentWorkspaceDir } = require('./utils/pathUtils');

const STATE_VERSION = 1;

class OnboardingStateService {
  constructor({ logger = console, storePath = null } = {}) {
    this.logger = logger;
    this.storePath = storePath ? path.resolve(String(storePath)) : this.resolveStorePath();
  }

  static getInstance(options = {}) {
    if (!OnboardingStateService.instance) {
      OnboardingStateService.instance = new OnboardingStateService(options);
    }
    return OnboardingStateService.instance;
  }

  resolveStorePath() {
    const dataDirRaw = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
    const baseDir = dataDirRaw ? path.resolve(dataDirRaw) : getAgentWorkspaceDir();
    try {
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    } catch {
      // ignore
    }
    return path.join(baseDir, 'onboarding-state.json');
  }

  getDefaultState() {
    return {
      version: STATE_VERSION,
      updatedAt: null,
      dependencySetup: {
        legalAccepted: false,
        completed: false,
        dismissed: false,
        currentStep: 0,
        skippedActionIds: []
      }
    };
  }

  normalizeSkippedActionIds(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    for (const rawId of value) {
      const id = String(rawId || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    return result;
  }

  normalizeDependencySetupState(value) {
    const next = (value && typeof value === 'object') ? value : {};
    const currentStepRaw = Number.parseInt(String(next.currentStep ?? 0), 10);
    return {
      legalAccepted: next.legalAccepted === true,
      completed: next.completed === true,
      dismissed: next.dismissed === true,
      currentStep: Number.isFinite(currentStepRaw) && currentStepRaw >= 0 ? currentStepRaw : 0,
      skippedActionIds: this.normalizeSkippedActionIds(next.skippedActionIds)
    };
  }

  loadState() {
    const defaults = this.getDefaultState();
    try {
      if (!fs.existsSync(this.storePath)) {
        return defaults;
      }
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      return {
        version: STATE_VERSION,
        updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
        dependencySetup: this.normalizeDependencySetupState(parsed?.dependencySetup)
      };
    } catch (error) {
      this.logger.warn?.('Failed to load onboarding state', {
        path: this.storePath,
        error: error.message
      });
      return defaults;
    }
  }

  saveState(state) {
    const normalized = {
      version: STATE_VERSION,
      updatedAt: new Date().toISOString(),
      dependencySetup: this.normalizeDependencySetupState(state?.dependencySetup)
    };
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.storePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
    fs.renameSync(tmpPath, this.storePath);
    return normalized;
  }

  getDependencySetupState() {
    return this.loadState().dependencySetup;
  }

  updateDependencySetupState(patch = {}) {
    const current = this.loadState();
    const next = {
      ...current,
      dependencySetup: this.normalizeDependencySetupState({
        ...(current?.dependencySetup || {}),
        ...((patch && typeof patch === 'object') ? patch : {})
      })
    };
    return this.saveState(next).dependencySetup;
  }
}

module.exports = { OnboardingStateService };
