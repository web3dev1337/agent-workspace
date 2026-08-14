# Agent Evidence Protocol

How agents prove their work so a human can approve/merge **at a glance** from the Review Queue. The Queue's Evidence card renders exactly what you report here.

## Why

A finished task is only reviewable-in-minutes if it arrives with proof: tests that ran, the app actually launched, reviewer verdicts, screenshots, and before/after data. Green tests alone are weak evidence for games/UI work (automated checks catch ~30% of issues there) — visual/runtime proof is first-class, not optional.

## How to report

Emit a fenced `agent-evidence` block containing ONE JSON object. Three supported channels, checked in this order:

1. **PR body or PR comment** (preferred — travels with the PR):
   ````
   ```agent-evidence
   { ...json... }
   ```
   ````
2. **Worktree file** `.agent-evidence.json` at the worktree root (for work without a PR yet). Put media files in `.agent-evidence/` next to it. Keep both out of the diff: add `.agent-evidence*` to `.gitignore` if untracked.
3. **Direct API** (advanced): `PUT /api/process/evidence/<urlencoded task id>` with `{ "evidence": { ... } }` against the orchestrator.

Multiple blocks merge: later blocks override scalar sections (`summary`, `tests`, `appRun`, `handoff`); `reviews`/`media`/`data`/`standards` accumulate with de-duplication. Reviewer agents append their own blocks as PR comments — never edit someone else's.

## Schema

```json
{
  "summary": "One-line: what was built/fixed and how it was verified.",
  "tests": {
    "ran": true,
    "command": "npm test",
    "passed": 47,
    "failed": 0,
    "output": "optional tail of the run (≤4000 chars)"
  },
  "appRun": {
    "ran": true,
    "method": "puppeteer | server-smoke | studio | browser | manual",
    "url": "http://172.x.x.x:5555 (if a server is up)",
    "notes": "what you exercised, console errors seen (should be none)"
  },
  "media": [
    { "type": "image", "path": ".agent-evidence/feature.png", "caption": "New spawn menu" }
  ],
  "data": [
    { "metric": "boss dps", "before": 120, "after": 90, "note": "autoplay, 3 runs avg" }
  ],
  "reviews": [
    {
      "role": "security", "agentId": "codex", "model": "gpt-5.5",
      "verdict": "approved", "summary": "No injection surfaces added.",
      "findings": 2, "fixed": 2
    }
  ],
  "standards": ["CLAUDE.md", "docs/CODE_STANDARDS.md"],
  "handoff": {
    "notes": "State + next steps for a successor agent (prompt caches expire ~1h — a fresh session will start from THIS, so make it complete: branch, what's done, what's risky, exact next commands)."
  }
}
```

Field notes:
- `tests` — report what you ACTUALLY ran. Never claim green you didn't see. If there are no tests, say so (`"ran": false`) rather than omitting.
- `appRun.method` — how the app was really exercised: `puppeteer` (headless browser, screenshots captured), `server-smoke` (started + curl'd), `studio` (Roblox Studio), `manual`, etc.
- `media.path` — relative to the worktree root; only files inside the worktree are servable. Allowed: png/jpg/jpeg/gif/webp/svg/mp4/webm/mov.
- `data` — REQUIRED for balance/tuning changes: measured before/after, not intended values.
- `reviews` — one entry per completed review stage. Verdicts: `approved` | `needs_fix` | `commented` | `skipped`.
- `diffStats` — ignored for PRs; the server computes it from GitHub.
- `standards` — the docs you (and your reviewers) checked the change against.

## Reviewer agents

If you are a review-chain stage (see `config/review-workflows.json`), you MUST:
1. Post your result as a PR comment containing an `agent-evidence` block with a single `reviews[]` entry (your role, verdict, findings/fixed counts, one-paragraph summary).
2. Submit the matching GitHub verdict: `gh pr review N --approve|--request-changes|--comment -b "..."`.
Read earlier stages' comments first (`gh pr view N --comments`) — verify their reported fixes instead of repeating findings.

## Self-orchestrated chains (optional)

An implementer agent may run its own review chain before requesting human review: spawn 1–3 read-only reviewer subagents with distinct lenses (general / security / performance), have each return findings, fix what's real, then record the chain in `reviews[]` (`"agentId": "claude", "by": "self-chain"`). Error rates multiply — two independent 30%-miss reviewers compound to ~9% — so even one extra lens materially hardens the work. Do this especially for tier-3 background tasks where the human reviews in batch.

## Handoff notes (fresh-window reprompts)

Anthropic prompt caches expire after ~1 hour idle. If your task may be re-prompted later (review feedback, follow-ups), keep `handoff.notes` current — the orchestrator offers a "Reprompt (fresh)" flow that seeds a NEW session from your handoff notes instead of continuing a cold one.
