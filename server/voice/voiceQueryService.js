const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

/**
 * Tier 2.5: deterministic data fetchers for voice queries.
 *
 * "show me Rocky's PRs today" should never need Claude — it is a gh search
 * plus a sentence. Entities arrive already resolved (registry aliases), the
 * answers come from gh (30s-cached upstream) and local orchestrator state, and
 * the reply is a template sentence so the whole lane stays sub-second when gh
 * is warm.
 */
class VoiceQueryService {
  constructor({ logger = console, registry = null } = {}) {
    this.logger = logger;
    this.registry = registry;
    this.ghCache = new Map();
    this.activityLog = path.join(os.homedir(), '.orchestrator', 'activity.jsonl');
  }

  static getInstance(options = {}) {
    if (!VoiceQueryService.instance) {
      VoiceQueryService.instance = new VoiceQueryService(options);
    }
    return VoiceQueryService.instance;
  }

  gh(args, timeoutMs = 8000) {
    const key = args.join(' ');
    const hit = this.ghCache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return Promise.resolve(hit.out);
    return new Promise((resolve) => {
      execFile('gh', args, { timeout: timeoutMs }, (err, stdout) => {
        const out = err ? null : stdout;
        if (out !== null) this.ghCache.set(key, { at: Date.now(), out });
        resolve(out);
      });
    });
  }

  speakList(items, formatter, { max = 3, none = 'none' } = {}) {
    if (!items.length) return none;
    const spoken = items.slice(0, max).map(formatter).join('; ');
    const more = items.length > max ? `, and ${items.length - max} more` : '';
    return spoken + more;
  }

  /**
   * Answer a resolved query. `classification` is tier-2 output (entities set);
   * `ctx` is the brain's live snapshot. Returns a spoken sentence or null when
   * this lane has no deterministic answer (caller falls to tier 3).
   */
  async answer(transcript, classification = {}, ctx = {}) {
    const low = String(transcript || '').toLowerCase();
    const { person, project, product } = classification;
    const reg = this.registry?.load?.() || { people: [], projects: [] };
    const personEntry = reg.people?.find((p) => p.name === person) || null;
    const projectEntry = reg.projects?.find((p) => p.name === project)
      || reg.products?.find((p) => p.name === (product || project)) || null;

    // --- PR queries ---
    if (/\b(pr|prs|pull request|pull requests)\b/.test(low)) {
      const args = ['search', 'prs', '--state', 'open', '--limit', '10',
        '--json', 'title,number,repository,updatedAt'];
      if (personEntry?.github) args.push('--author', personEntry.github);
      else {
        const owner = this.registry?.defaults?.().githubOwner
          || (reg.projects?.find((p) => p.repo)?.repo || '').split('/')[0];
        if (owner) args.push('--owner', owner);
      }
      if (/today/.test(low)) {
        const today = new Date().toISOString().slice(0, 10);
        args.push('--created', `>=${today}`);
      }
      if (projectEntry?.repo) args.push('--repo', projectEntry.repo);
      const out = await this.gh(args);
      if (out === null) return null;
      let prs = [];
      try { prs = JSON.parse(out); } catch { return null; }
      const who = person ? `${person} has` : 'There are';
      if (!prs.length) return `${who} no open PRs${project ? ` on ${project}` : ''}${/today/.test(low) ? ' from today' : ''}.`;
      const list = this.speakList(prs, (p) => `number ${p.number}, ${p.title}`);
      return `${who} ${prs.length} open PR${prs.length > 1 ? 's' : ''}${project ? ` on ${project}` : ''}: ${list}.`;
    }

    // --- recent activity of a person ---
    if (personEntry?.github && /\b(doing|working|push|pushed|done|up to)\b/.test(low)) {
      const args = ['search', 'prs', '--author', personEntry.github, '--limit', '5',
        '--sort', 'updated', '--json', 'title,number,repository,state,updatedAt'];
      if (projectEntry?.repo) args.push('--repo', projectEntry.repo);
      const out = await this.gh(args);
      if (out === null) return null;
      let prs = [];
      try { prs = JSON.parse(out); } catch { return null; }
      if (!prs.length) return `I don't see recent PR activity from ${person}${project ? ` on ${project}` : ''}.`;
      const latest = prs[0];
      const repoName = latest.repository?.name || 'a repo';
      return `${person}'s latest activity is PR ${latest.number} on ${repoName}: ${latest.title} (${latest.state}).`;
    }

    // --- session/worktree state from the live snapshot ---
    if (/\b(session|sessions|agents?)\b/.test(low) && /\b(how many|running|active|idle|which|wich)\b/.test(low)) {
      const sessions = Array.isArray(ctx.sessions) ? ctx.sessions : [];
      if (/idle/.test(low)) {
        const idle = sessions.filter((s) => /idle|waiting/i.test(s.status || ''));
        return idle.length
          ? `${idle.length} idle: ${this.speakList(idle, (s) => s.id || s.name || 'unknown')}.`
          : 'No agents are idle right now.';
      }
      return `${sessions.length} session${sessions.length === 1 ? '' : 's'} active right now.`;
    }
    if (classification.worktree && /\b(busy|idle|status|doing)\b/.test(low)) {
      const sessions = Array.isArray(ctx.sessions) ? ctx.sessions : [];
      const match = sessions.find((s) => String(s.id || '').includes(classification.worktree));
      if (match) return `${classification.worktree} is ${match.status || 'active'}${match.branch ? ` on ${match.branch}` : ''}.`;
      return `Nothing is running on ${classification.worktree}.`;
    }

    // --- time-window history from the activity log ---
    const windowMatch = low.match(/last\s+(\d+)\s+(hour|hours|day|days)/);
    if (windowMatch || /\b(what happened|history|recently)\b/.test(low)) {
      const hours = windowMatch
        ? Number(windowMatch[1]) * (windowMatch[2].startsWith('day') ? 24 : 1)
        : 12;
      const since = Date.now() - hours * 3600_000;
      let lines = [];
      try {
        lines = fs.readFileSync(this.activityLog, 'utf8').trim().split('\n').slice(-500);
      } catch { return null; }
      const events = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const at = Date.parse(e.at || e.timestamp || 0);
          if (at < since) continue;
          const text = JSON.stringify(e).toLowerCase();
          if (projectEntry && !(projectEntry.repo && text.includes(projectEntry.repo.split('/')[1].toLowerCase()))
              && !(projectEntry.path && text.includes(path.basename(projectEntry.path).toLowerCase()))) continue;
          events.push(e);
        } catch { /* skip bad lines */ }
      }
      if (!events.length) return `No recorded activity${project ? ` on ${project}` : ''} in the last ${hours} hours.`;
      const kinds = {};
      for (const e of events) kinds[e.event || e.type || 'event'] = (kinds[e.event || e.type || 'event'] || 0) + 1;
      const summary = Object.entries(kinds).slice(0, 4).map(([k, n]) => `${n} ${k.replace(/[._]/g, ' ')}`).join(', ');
      return `In the last ${hours} hours${project ? ` on ${project}` : ''}: ${events.length} events — ${summary}.`;
    }

    return null;
  }
}

module.exports = VoiceQueryService;
