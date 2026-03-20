const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encryptObject, decryptObject, DEFAULT_SECRET_ENV } = require('./encryptedStore');
const { normalizeServiceManifest, getWorkspaceServiceManifest, mergeServiceManifests } = require('./workspaceServiceStackService');

const DEFAULT_SHARED_REL_PATH = '.agent-workspace/service-stack/team-baseline.json';
const DEFAULT_ENCRYPTED_REL_PATH = '.agent-workspace/service-stack/team-baseline.enc.json';
const SIGNING_SECRET_ENV = 'ORCHESTRATOR_SHARED_CONFIG_SIGNING_SECRET';

class ConfigPromoterService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  static getInstance(options = {}) {
    if (!ConfigPromoterService.instance) {
      ConfigPromoterService.instance = new ConfigPromoterService(options);
    }
    return ConfigPromoterService.instance;
  }

  resolveWorkspaceRepoRoot(workspace) {
    const candidates = [];
    const repoPath = String(workspace?.repository?.path || '').trim();
    if (repoPath) candidates.push(repoPath);

    const terminals = Array.isArray(workspace?.terminals) ? workspace.terminals : [];
    for (const terminal of terminals) {
      const terminalRepoPath = String(terminal?.repository?.path || '').trim();
      if (terminalRepoPath) candidates.push(terminalRepoPath);
      const worktreePath = String(terminal?.worktreePath || '').trim();
      if (worktreePath) {
        candidates.push(worktreePath);
        candidates.push(path.dirname(worktreePath));
      }
    }

    for (const raw of candidates) {
      const candidate = path.resolve(raw);
      const gitDir = path.join(candidate, '.git');
      if (fsSync.existsSync(gitDir)) return candidate;
    }

    return candidates.length ? path.resolve(candidates[0]) : '';
  }

  resolveSafeRelativePath(repoRoot, relPath, { visibility = 'shared' } = {}) {
    const rootRaw = String(repoRoot || '').trim();
    if (!rootRaw) throw new Error('repoRoot is required');
    const root = path.resolve(rootRaw);

    const fallback = visibility === 'encrypted' ? DEFAULT_ENCRYPTED_REL_PATH : DEFAULT_SHARED_REL_PATH;
    const rel = String(relPath || fallback).trim();
    if (!rel) throw new Error('relPath is required');
    if (path.isAbsolute(rel)) throw new Error('relPath must be relative');

    const normalized = path.normalize(rel);
    if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
      throw new Error('relPath must not traverse directories');
    }

    const full = path.resolve(root, normalized);
    if (!full.startsWith(`${root}${path.sep}`) && full !== root) {
      throw new Error('relPath escapes repoRoot');
    }

    return {
      repoRoot: root,
      relPath: normalized,
      fullPath: full
    };
  }

  buildSignature({ envelope, secret }) {
    const payload = {
      schemaVersion: envelope.schemaVersion,
      kind: envelope.kind,
      createdAt: envelope.createdAt,
      workspaceId: envelope.workspaceId,
      visibility: envelope.visibility,
      manifest: envelope.manifest
    };
    const body = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body, 'utf8');
    return `sha256=${hmac.digest('hex')}`;
  }

  verifySignature({ envelope, secret }) {
    const expected = this.buildSignature({ envelope, secret });
    const got = String(envelope?.signature || '').trim();
    if (!got) return false;
    if (got.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  }

  normalizeVisibility(value) {
    const visibility = String(value || 'shared').trim().toLowerCase();
    if (visibility !== 'shared' && visibility !== 'encrypted') {
      throw new Error('visibility must be shared|encrypted');
    }
    return visibility;
  }

  async writeTeamManifest({ workspace, manifest, visibility = 'shared', repoRoot, relPath, passphrase, signed = false, signingSecret } = {}) {
    if (!workspace || typeof workspace !== 'object') throw new Error('workspace is required');

    const normalizedVisibility = this.normalizeVisibility(visibility);
    const resolvedRepoRoot = String(repoRoot || this.resolveWorkspaceRepoRoot(workspace)).trim();
    if (!resolvedRepoRoot) throw new Error('Could not resolve repoRoot for workspace');

    const normalizedManifest = normalizeServiceManifest(manifest || getWorkspaceServiceManifest(workspace), { strict: true });
    const location = this.resolveSafeRelativePath(resolvedRepoRoot, relPath, { visibility: normalizedVisibility });

    const envelope = {
      schemaVersion: 1,
      kind: 'orchestrator-service-stack-baseline',
      createdAt: new Date().toISOString(),
      workspaceId: String(workspace.id || '').trim() || null,
      workspaceName: String(workspace.name || '').trim() || null,
      visibility: normalizedVisibility,
      manifest: normalizedManifest
    };

    const useSignature = signed === true;
    if (useSignature) {
      const secret = String(signingSecret || process.env[SIGNING_SECRET_ENV] || '').trim();
      if (!secret) throw new Error(`signed export requires ${SIGNING_SECRET_ENV}`);
      envelope.signature = this.buildSignature({ envelope, secret });
    }

    await fs.mkdir(path.dirname(location.fullPath), { recursive: true });
    if (normalizedVisibility === 'encrypted') {
      const payload = encryptObject({ value: envelope, passphrase, envKey: DEFAULT_SECRET_ENV });
      await fs.writeFile(location.fullPath, JSON.stringify(payload, null, 2), 'utf8');
    } else {
      await fs.writeFile(location.fullPath, JSON.stringify(envelope, null, 2), 'utf8');
    }

    return {
      location,
      envelope,
      pointer: {
        repoRoot: location.repoRoot,
        relPath: location.relPath,
        visibility: normalizedVisibility,
        signed: useSignature,
        updatedAt: new Date().toISOString()
      }
    };
  }

  async readTeamManifest({ workspace, pointer, repoRoot, relPath, visibility = null, passphrase, signingSecret } = {}) {
    const normalizedVisibility = this.normalizeVisibility(visibility || pointer?.visibility || 'shared');
    const fallbackRoot = workspace ? this.resolveWorkspaceRepoRoot(workspace) : '';
    const resolvedRepoRoot = String(repoRoot || pointer?.repoRoot || fallbackRoot).trim();
    if (!resolvedRepoRoot) throw new Error('repoRoot is required to read team manifest');

    const location = this.resolveSafeRelativePath(resolvedRepoRoot, relPath || pointer?.relPath, { visibility: normalizedVisibility });
    if (!fsSync.existsSync(location.fullPath)) {
      throw new Error(`Team manifest not found: ${location.relPath}`);
    }

    const rawText = await fs.readFile(location.fullPath, 'utf8');
    let envelope;
    if (normalizedVisibility === 'encrypted') {
      const payload = JSON.parse(rawText);
      envelope = decryptObject({ payload, passphrase, envKey: DEFAULT_SECRET_ENV });
    } else {
      envelope = JSON.parse(rawText);
    }

    if (!envelope || typeof envelope !== 'object') {
      throw new Error('Invalid team manifest payload');
    }

    const directManifest = envelope.manifest ? envelope.manifest : envelope;
    const manifest = normalizeServiceManifest(directManifest, { strict: true });

    const requiresSignature = pointer?.requireSignature === true;
    const signedFlag = pointer?.signed === true || !!envelope.signature;
    const secret = String(signingSecret || process.env[SIGNING_SECRET_ENV] || '').trim();

    let signatureVerified = null;
    if (signedFlag) {
      if (secret) {
        signatureVerified = this.verifySignature({ envelope: { ...envelope, manifest }, secret });
      } else if (requiresSignature) {
        throw new Error(`Manifest signature required but ${SIGNING_SECRET_ENV} is not configured`);
      }
    }

    if (requiresSignature && signatureVerified !== true) {
      throw new Error('Manifest signature verification failed');
    }

    return {
      location,
      envelope,
      manifest,
      signatureVerified,
      pointer: {
        repoRoot: location.repoRoot,
        relPath: location.relPath,
        visibility: normalizedVisibility,
        signed: signedFlag,
        requireSignature: requiresSignature,
        updatedAt: new Date().toISOString()
      }
    };
  }

  resolveWorkspaceManifest(workspace, { passphrase, signingSecret } = {}) {
    const localSource = workspace?.serviceStackLocal ?? workspace?.serviceStack ?? workspace?.services;
    const localManifest = normalizeServiceManifest(localSource || { services: [] }, { strict: false });

    const pointer = workspace?.serviceStackShared;
    if (!pointer || typeof pointer !== 'object') {
      return localManifest;
    }

    try {
      const visibility = String(pointer.visibility || 'shared').trim().toLowerCase() || 'shared';
      const repoRoot = String(pointer.repoRoot || this.resolveWorkspaceRepoRoot(workspace) || '').trim();
      const location = this.resolveSafeRelativePath(repoRoot, pointer.relPath, { visibility });
      if (!fsSync.existsSync(location.fullPath)) {
        return localManifest;
      }
      const rawText = fsSync.readFileSync(location.fullPath, 'utf8');
      let envelope;
      if (visibility === 'encrypted') {
        const payload = JSON.parse(rawText);
        envelope = decryptObject({ payload, passphrase, envKey: DEFAULT_SECRET_ENV });
      } else {
        envelope = JSON.parse(rawText);
      }

      const manifestRaw = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
        ? (envelope.manifest || envelope)
        : {};
      const sharedManifest = normalizeServiceManifest(manifestRaw, { strict: true });

      if ((pointer.requireSignature === true || pointer.signed === true) && envelope && envelope.signature) {
        const secret = String(signingSecret || process.env[SIGNING_SECRET_ENV] || '').trim();
        if (secret) {
          const verified = this.verifySignature({ envelope: { ...envelope, manifest: sharedManifest }, secret });
          if (pointer.requireSignature === true && !verified) {
            throw new Error('Manifest signature verification failed');
          }
        } else if (pointer.requireSignature === true) {
          throw new Error(`Manifest signature required but ${SIGNING_SECRET_ENV} is not configured`);
        }
      }

      return mergeServiceManifests(sharedManifest, localManifest);
    } catch (error) {
      this.logger.warn?.('Failed to resolve shared service-stack baseline; using local manifest only', {
        workspaceId: workspace?.id,
        error: error.message
      });
      return localManifest;
    }
  }
}

module.exports = {
  ConfigPromoterService,
  DEFAULT_SHARED_REL_PATH,
  DEFAULT_ENCRYPTED_REL_PATH,
  SIGNING_SECRET_ENV
};
