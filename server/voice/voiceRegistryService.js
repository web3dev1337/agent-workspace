const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The voice registry: spoken names -> canonical truth.
 *
 * STT hears "an rocks prs on high fire"; this service is what knows that means
 * person AnrokX on repo HyFire. People, projects (repos), and products (a game
 * whose spoken name differs from its folder, living at a subpath inside a
 * repo) all carry alias lists. Identities are DATA, so they live in an
 * untracked user file — the repo ships no real names.
 *
 * Sources (later wins):
 *   1. <repo>/config/voice-registry.json   (placeholders / team-shared shape)
 *   2. ~/.orchestrator/voice-registry.json (the user's real people/projects)
 */
class VoiceRegistryService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.registry = { people: [], projects: [], products: [], defaults: {} };
    this.loadedAt = 0;
  }

  static getInstance(options = {}) {
    if (!VoiceRegistryService.instance) {
      VoiceRegistryService.instance = new VoiceRegistryService(options);
    }
    return VoiceRegistryService.instance;
  }

  sources() {
    return [
      path.join(__dirname, '..', '..', 'config', 'voice-registry.json'),
      path.join(os.homedir(), '.orchestrator', 'voice-registry.json')
    ];
  }

  load({ force = false } = {}) {
    // Registries change rarely; a 30s cache keeps utterance handling file-free.
    if (!force && Date.now() - this.loadedAt < 30_000) return this.registry;
    const merged = { people: [], projects: [], products: [], defaults: {} };
    for (const file of this.sources()) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const key of ['people', 'projects', 'products']) {
          for (const entry of data[key] || []) {
            // Placeholder shapes (github/repo like "<gh-login>") document the
            // format; they must never pollute the real roster or the enums.
            if (/^<.*>$/.test(String(entry.github || entry.repo || ''))) continue;
            const list = merged[key];
            const existing = list.findIndex((e) => e.name === entry.name);
            if (existing >= 0) list[existing] = entry;
            else list.push(entry);
          }
        }
        Object.assign(merged.defaults, data.defaults || {});
      } catch {
        // Missing/invalid file at any level is fine.
      }
    }
    this.registry = merged;
    this.loadedAt = Date.now();
    return merged;
  }

  /**
   * Longest-alias-first resolution, so "astro shooter" (project) wins over
   * "astro" (person) when both occur. Returns every entity found.
   */
  resolve(transcript) {
    const text = ` ${String(transcript || '').toLowerCase()} `;
    const reg = this.load();
    const found = { person: null, project: null, product: null };
    const candidates = [];
    for (const kind of ['products', 'projects', 'people']) {
      for (const entry of reg[kind] || []) {
        for (const alias of [entry.name?.toLowerCase(), ...(entry.aliases || [])]) {
          if (alias) candidates.push({ kind, entry, alias: alias.toLowerCase() });
        }
      }
    }
    candidates.sort((a, b) => b.alias.length - a.alias.length);
    let remaining = text;
    for (const c of candidates) {
      if (!remaining.includes(` ${c.alias} `) && !remaining.includes(` ${c.alias}s `)
          && !remaining.includes(` ${c.alias}'s `)) continue;
      const slot = { products: 'product', projects: 'project', people: 'person' }[c.kind];
      if (!found[slot]) {
        found[slot] = c.entry;
        // Consume the alias so "astro shooter" doesn't ALSO match person "astro".
        remaining = remaining.split(c.alias).join(' ');
      }
    }
    // A product implies its repo project when none was said directly.
    if (found.product && !found.project) {
      found.project = (reg.projects || []).find((p) => p.repo === found.product.repo) || null;
    }
    return found;
  }

  defaults() {
    return { launchAgent: 'claude', launchEffort: 'low', reviewAgent: 'codex', ...this.load().defaults };
  }

  /** Rich listing for the tier-3 chat brain: who and what everything IS. */
  knowledgeBlock() {
    const reg = this.load();
    const lines = [];
    if (reg.people?.length) {
      lines.push('PEOPLE (teammates): ' + reg.people.map((p) => `${p.name} (github ${p.github})`).join('; '));
    }
    if (reg.projects?.length) {
      lines.push('PROJECTS:');
      for (const p of reg.projects) {
        lines.push(`- ${p.name}: ${p.desc || p.$comment || ''}${p.repo ? ` [repo ${p.repo}]` : ''}`);
      }
    }
    if (reg.products?.length) {
      lines.push('GAMES/PRODUCTS (spoken name -> where they live):');
      for (const p of reg.products) {
        lines.push(`- ${p.name}: in ${p.repo}${p.subpath ? ` under ${p.subpath}` : ''}`);
      }
    }
    return lines.join('\n');
  }

  /** Compact prompt-ready listing for the tier-2 model. */
  promptBlock() {
    const reg = this.load();
    const people = (reg.people || []).map((p) => p.name).join(', ');
    const projects = (reg.projects || []).map((p) => p.name).join(', ');
    const products = (reg.products || []).map((p) => p.name).join(', ');
    return `PEOPLE: ${people || 'none'}. PROJECTS: ${projects || 'none'}. GAMES/PRODUCTS: ${products || 'none'}.`;
  }

  /** Enum values for the grammar — canonical names only, "" = not mentioned. */
  enums() {
    const reg = this.load();
    return {
      people: [...(reg.people || []).map((p) => p.name), ''],
      projects: [...(reg.projects || []).map((p) => p.name), ...(reg.products || []).map((p) => p.name), '']
    };
  }
}

module.exports = VoiceRegistryService;
