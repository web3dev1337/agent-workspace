# JARVIS Voice Stack — Tiered Architecture & Workflow Integration Plan

Date: 2026-08-15
Status: DESIGN — tiers 0–4 partially live in the `pr1029-jarvis-test` sandbox; registries, review chains, and the Realtime Manager are new.

The principle: **every layer is strictly cheaper and faster than the one below it, and a request only falls through on a miss.** Feedback (voice) is decoupled from execution — the voice that talks to you is never required to be the model doing the work.

---

## 1. The Ladder (tiers, models, inputs/outputs, timings)

### Tier 0 — Ears (STT)
- **Model**: faster-whisper `large-v3`, GPU, float16 (`medium` as the low-VRAM fallback).
- **Input**: push-to-talk audio (V key / mic button), webm/opus from browser.
- **Output**: `{ transcript, transcriptionTimeMs }`.
- **Timing**: 0.3–1.0s once resident. Model stays loaded after first use.
- **Cost**: zero (local).

### Tier 1 — Reflex (exact command match)
- **Model**: NONE. Registry lookup in `voiceCommandService` (phrasebook → semantic commands).
- **Input**: transcript string.
- **Output**: executed orchestrator API call + short ack ("Done — open queue").
- **Timing**: <50ms.
- **Rule**: 1:1 phrase hit ⇒ run instantly, no confirmation, no LLM. Non-negotiable fast path.

### Tier 2 — Intent matcher (tiny model + FULL context)  ← the key upgrade
- **Model**: TINY, GEPA-calibrated. Target: **Bonsai-1.7B Q8** (already in `~/AI-Models`; 4B as the step-up) served by llama.cpp with **GBNF grammar-constrained decoding** — the JSON schema is enforced by the grammar, so the model's only degree of freedom is choosing the label. Expected latency ~100–300ms resident.
- **Calibration**: intent matching is closed-label classification — ideal for the `local-model-calibration` / GEPA loop. Eval set = real transcripts harvested from the Jarvis chat log; a large model labels them; the prompt is evolved against that set until accuracy plateaus. Re-run the loop whenever commands/registries change materially.
- **Bootstrap**: ship on `llama3.1:8b` (warm today) while the Bonsai eval set accumulates; swap via `voice-tiers.json` once calibrated accuracy ≥ the 8b baseline.
- **Why tiny matters**: with an 8b at tier 2, tiers 2 and 3 are too close in cost. Bonsai makes the ladder properly exponential: 0ms → ~0.2s → ~2s → minutes. Confidence-gating means small never costs correctness — only saves latency on the easy majority.
- **Input**: a SINGLE prompt assembled per utterance:
  - full command registry (name, params, one-line description)
  - **live snapshot**: workspaces, worktrees + states, session list + status/branch, queue depth, active tiers
  - **team registry** (§3) + **project registry** (§3)
  - the transcript
- **Output (strict JSON)**: `{ intent: "command"|"query"|"chat"|"task", command?, params?, confidence: 0..1 }`
  - `command` + confidence ≥ threshold ⇒ execute (same path as Tier 1) + spoken ack
  - `query` ⇒ Tier 2.5 data fetcher
  - `chat` ⇒ Tier 3
  - `task` or low confidence ⇒ Tier 3 arbiter or straight to Tier 4 (configurable)
- **Timing**: 0.5–1.5s. Keep the static prompt prefix byte-stable so llama.cpp/Ollama prompt caching only pays for the snapshot + utterance.

### Tier 2.5 — Data fetcher (no LLM, or Tier-2 model for phrasing)
Deterministic resolvers for the query intents that must NOT need Claude:
- "show me Rocky's PRs today" → `gh search prs --author=<gh-login> --created=>{today}` via the existing **githubRepoService PR cache (30s TTL, merged to main 2026-08-15)**
- "what is he working on" → task-records + session states + activity feed tail
- "what happened in the last 12 hours on <project>" → activity.jsonl filtered by project + `gh` PR/commit search on the project's repo
- **Output**: compact facts → Tier-2 model phrases them into one spoken sentence (or template strings for zero-LLM mode).
- **Timing**: 0.1–2s depending on gh cache hit.

### Tier 3 — Local brain (conversation + arbiter)
- **Model**: best local model. Today Qwen3.5-9B @ 18866 (16K ctx/slot); upgrade path Qwen3.8-27B (NVFP4/vLLM) with zero code change (`VOICE_CHAT_URL`).
- **System prompt**: voice framing + `docs/COMMANDER_CLAUDE.md` + registries. Static prefix → server prompt cache keeps re-prefill ~0.
- **Roles**: (a) freeform conversation, (b) arbiter for ambiguous Tier-2 output ("did they mean X?"), (c) drafting the prompt that Tier 4 will receive ("send a prompt to the zoo agent about the camera bug" → composes the actual prompt text).
- **Output**: spoken prose ≤2 sentences, or `{escalate: true, brief: "..."}`.
- **Timing**: 1.5–3.5s.

### Tier 4 — Commander (execution agent)
- **Model**: Claude Code session in a Commander instance. **Sonnet, low effort** for voice-originated tasks (speed); Fable/Opus reserved for explicitly hard asks ("think hard about…" phrase can select it).
- **Input**: `[voice]`-tagged brief (from Tier 3 or raw), instruction to reply in 1–2 plain sentences.
- **Output**: real orchestrator actions (launch agents, send prompts to sessions, gh operations) + a `⏺`-line reply captured and spoken.
- **Timing**: 5s–minutes. "On it." ack fires immediately; progress narration comes from the Feedback layer (§5), not from blocking.

### Escalation config (all of it lives in one file)
`config/voice-tiers.json` (new): per-tier model/endpoint, confidence thresholds, which intents may skip tiers, per-action feedback policy (§5), and which model Tier 4 uses per risk level. Models are swappable per tier because the mouth (Kokoro) is constant.

---

## 2. Voice out (constant across all tiers)
- **Kokoro** GPU server (OpenAI-compatible + `/synthesize`), `af_heart`, speed 2.0 (user preference), 110ms warm.
- Every tier's text reply goes through the same `speechService` → browser playback; the Jarvis chat log panel shows the written transcript with lane + latency metadata.

---

## 3. Registries (the context that makes Tier 2 smart)

New file `config/voice-registry.json` (cascadable like `.orchestrator-config.json`, user overlay in `~/.orchestrator/voice-registry.json`):

```json
{
  "people": [
    { "name": "Rocky",  "aliases": ["rocky", "rock e"], "github": "<gh-login>" },
    { "name": "Blue",  "aliases": ["astro"],  "github": "<gh-login>" },
    { "name": "Green",  "aliases": ["ganga"],  "github": "<gh-login>" }
  ],
  "projects": [
    { "name": "Zoo Game", "aliases": ["zoo", "the zoo one"], "repo": "web3dev1337/zoo-game",
      "path": "~/GitHub/games/hytopia/zoo-game", "board": "Zoo Hytopia", "desc": "Hytopia zoo tycoon game" }
  ]
}
```

- **Aliases are load-bearing**: STT hears "rock ee" — the registry is what turns that into `author:<gh-login>`.
- People/projects/boards resolve BEFORE any model call where possible (string match on aliases), and are injected into Tier-2/3 prompts otherwise.
- GH logins must be real accounts so `gh search prs --author` works. Fill during implementation.

---

## 4. How the orchestrator SEES what everyone is doing (live vs polling)

| Signal | Mechanism | Freshness | Used by |
|---|---|---|---|
| Session activity (what each agent is typing/doing) | statusDetector reads pty buffers | ~1–2s (event-ish) | Tier 2.5, Realtime Manager |
| Session/worktree/queue state | in-memory managers + task-records.json | live | Tier 2 snapshot |
| Activity history | `~/.orchestrator/activity.jsonl` (append log) | live append | "last 12 hours" queries |
| GitHub PRs/reviews | `gh` search via cached service | 30s TTL cache, invalidated on merge/review | "Rocky's PRs today" |
| Teammate pushes/commits | `gh search` on demand (NOT streamed) | on-demand | Tier 2.5 |
| Discord | discordIntegrationService | polled | digest lane |

**Answer to "is it live or polling":** local session state is effectively live (pty + events); GitHub is on-demand-with-cache (30s), which is the right cost/freshness point — do NOT build a webhook receiver in v1. The Realtime Manager (§6) is the component that turns these passive signals into proactive speech.

**"Hermes agents": not a thing in this codebase** (verified — zero references). The concept the term gestures at — standing background watcher agents — is exactly §6; no external framework needed.

---

## 5. Feedback policy (configurable, decoupled)

Per action-class config in `voice-tiers.json`:

```json
"feedback": {
  "command":       { "ack": "instant", "confirm": false },
  "destructive":   { "ack": "confirm-first" },
  "task":          { "ack": "instant", "progress": "on-change", "done": "speak" },
  "query":         { "ack": "none", "done": "speak" }
}
```

- `confirm-first`: Jarvis repeats intent and waits for "yes" (for kill/remove/deploy class).
- `progress: on-change`: while Tier 4 works, the Realtime Manager narrates state TRANSITIONS only ("reviewer spawned", "tests passed"), never a heartbeat.

---

## 6. Realtime Manager (the new component)

- **What**: a dedicated **Commander instance tab** (new multi-instance support in main: `cmd-2`…`cmd-6`, addressable via `/api/commander/instances`). Label it "Manager". It is NOT the task-running Commander — it never executes work.
- **Model**: Sonnet low (cheap, fast). It runs a loop: read new activity-feed entries + status transitions + task-record changes since last tick → decide if anything crosses the "worth speaking" threshold → emit ≤1 sentence to speechService.
- **Cadence**: event-driven with a floor — woken by activity-feed events, hard minimum 30s between spoken updates, silence is the default.
- **Prompt-cache economics (the "1 hour" point)**: Claude prompt caches expire at the TTL (5min–1h). A standing Manager session keeps its own conversation context, so cache expiry costs re-prefill of the static prompt occasionally — acceptable at Sonnet prices. Do NOT add keep-warm pings for their own sake; the activity stream itself is the heartbeat, and quiet periods costing one re-prefill is cheaper than 24/7 pings.
- **Also serves**: `progress: on-change` narration for Tier-4 tasks, and "anything need me?" digest on request.

---

## 7. PR review chains (workflow integration)

Builds on existing task-records fields (`reviewerSpawnedAt`, `fixerSpawnedAt`, `reviewOutcome`, tiers) — the schema already anticipated this.

**Chain definition** (per project or per tier, in `voice-registry.json` or `.orchestrator-config.json`):

```json
"reviewChains": {
  "default": [
    { "agent": "codex",  "model": "gpt-5.6-sol", "mode": "review" },
    { "agent": "claude", "model": "sonnet",      "mode": "review" }
  ],
  "high-risk": [
    { "agent": "codex",  "model": "gpt-5.6-sol" },
    { "agent": "claude", "model": "fable", "effort": "high" },
    { "agent": "grok",   "model": "<if/when a grok CLI exists locally>" }
  ]
}
```

**Flow**: PR opened (or voice: "review Rocky's PR") → orchestrator spawns reviewer #1 in a fresh worktree → verdict written to task-record (`reviewOutcome`) → 
- `approved` → next reviewer in chain, or done → Manager announces
- `needs_fix` → configurable: (a) spawn a fixer agent in the PR branch worktree, or (b) send the feedback back to the ORIGINAL implementer's session if still alive (`send-to-session`), which preserves their context
→ chain re-runs from the failed step after fixes. Every transition lands in the activity feed ⇒ the Manager can narrate it and "what's the status of that review" is a Tier-2.5 query.

**Voice hooks**: "spawn a review chain on <PR>", "what did the reviewers say", "send it back to Rocky with the feedback".

---

## 8. End-to-end example flows

**"Open the queue"** → T0 0.5s → T1 exact hit → executed + "Done — open queue." Total ~1s.

**"Show me Rocky's PRs today"** → T0 → T1 miss → T2 classifies `query` + resolves person via registry (~1s) → T2.5 gh cached search (~0.3s) → T2 phrases → Kokoro. Total ~2.5s.

**"What do you think about the new duplex models?"** → T2 `chat` → T3 Qwen answers → Kokoro. Total ~3s.

**"Tell the zoo agent to fix the camera jitter and review it when done"** → T2 `task` → T3 drafts the agent prompt → T4 Commander: `send-to-session` to the zoo session + task-record annotated with review chain trigger → "On it." → later, Manager: "Zoo agent pushed a fix; Codex review chain started." → later: "Review passed."

---

## 9. Implementation phases

1. **P1 — Tier 2 context injection + registries** (highest value/effort): `voice-registry.json`, snapshot injection into intent prompt, strict-JSON output, threshold config. Extends `voiceCommandService`/`voiceBrainService` in the PR-1029 branch.
2. **P2 — Tier 2.5 resolvers**: person/project alias resolution + gh-cache queries + activity.jsonl time-window queries.
3. **P3 — Feedback policy config** + confirm-first for destructive class.
4. **P4 — Realtime Manager**: Commander instance "Manager", activity-feed tail loop, on-change narration.
5. **P5 — Review chains**: chain config + spawn/verdict/fix loop on task-records (this is orchestrator-side, voice just triggers/reports).
6. **P6 — model bumps**: 27B into Tier 3 when its runtime lands; Moshi in the `duplex` provider slot as an experiment; re-benchmark Tier 2 with smaller models.

Already live in the sandbox from today: T0 (whisper GPU), T1, T3 (doc-grounded Qwen via 18866 + Ollama fallback), T4 (Sonnet-low Commander), Kokoro voice + `/synthesize`, spinner-proof reply capture (`⏺`-line extraction), Jarvis chat-log panel inside Alt+J.

---

## 10. Open decisions (defaults chosen, flag to change)

- Tier-2 model: bootstrap `llama3.1:8b`, converge on GEPA-calibrated Bonsai-1.7B Q8 with GBNF grammar (see §1 Tier 2).
- Destructive-command list for confirm-first: `kill|remove|delete|stop|deploy|merge|push` param'd commands.
- Manager speaks by default vs opt-in per workspace: default ON in focus mode, OFF in background mode (ties into existing workflow modes).
- Grok in review chains: pending an actual local/CLI integration; chain config already allows arbitrary agents.
