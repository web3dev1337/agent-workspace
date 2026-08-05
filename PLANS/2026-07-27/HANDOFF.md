# Handoff — PR #1029 review + voice system (2026-07-27)

For the next agent. Everything done this session, why, how it's wired, how to run and
test it, what's verified, and what's left. Branch: `feature/autopilot-voice-and-repo-atlas`
(PR #1029). Worktree: `~/GitHub/tools/automation/agent-workspace/work1`.

## TL;DR of what this session did

1. **Reviewed PR #1029 and fixed ~20 real bugs** (crashes, a public-repo privacy leak, an
   RCE path, correctness/durability) — all committed, tested, pushed. See "Part A".
2. **Built a swappable local voice system** on top of the PR's JARVIS/voice work — the user's
   ask: talk to JARVIS naturally, full orchestrator visibility, fast API shortcuts, agent
   fallback, and models you can swap. See "Part B". This is the newer, less-battle-tested work.
3. **Installed a real local stack on this laptop**: Piper (TTS) + Ollama `llama3.2:3b` (fuzzy
   command LLM). Both verified working end to end.

Tests: **859 unit tests green, 119 suites** (`npm run test:unit`). Was 652 on main.

---

## Environment / running state (as left)

- **A live JARVIS instance is running** for manual testing:
  - Port **5857**, open at `http://localhost:5857` (localhost is required for the browser
    mic/speech — a secure context; the Windows browser reaches WSL over localhost, verified).
  - Launched with real `HOME` (so agents log in) but an **isolated data dir**
    `AGENT_WORKSPACE_DIR=~/.agent-workspace-jarvis-test` so it can't disturb the other
    orchestrator running on port 4000 (a different checkout). PID in `/tmp/pr1029-jarvis-server.pid`.
  - Env: `CODEX_APP_SERVER=true SUPERVISOR_AUTONOMY=observe OLLAMA_MODEL=llama3.2:3b`.
  - Relaunch command (from the worktree root):
    ```bash
    AGENT_WORKSPACE_DIR=~/.agent-workspace-jarvis-test CODEX_APP_SERVER=true \
      SUPERVISOR_AUTONOMY=observe OLLAMA_MODEL=llama3.2:3b ORCHESTRATOR_PORT=5857 \
      node server/index.js
    ```
- **Ollama is running** (local LLM for fuzzy voice commands): PID in `/tmp/ollama.pid`,
  API at `http://localhost:11434`. Binary at `~/.local/ollama/bin/ollama`, wrapper on PATH at
  `~/.local/bin/ollama` (sets `LD_LIBRARY_PATH` to `~/.local/ollama/lib`). Models: `llama3.2:3b`
  (used) + `llama3.2:1b`. To restart: `~/.local/bin/ollama serve &` then it's ready.
- **Piper (local TTS)** installed via `pip3 install --user --break-system-packages piper-tts`;
  voice model at `~/.local/share/piper-voices/en_US-amy-medium.onnx`. speechService
  auto-discovers it. Plays to Windows speakers over WSLg (`paplay` → RDPSink — verified).
- ⚠️ **These are NOT the production orchestrator.** Production is `master/` (port 3000, currently
  down); a dev instance runs on **4000** from `claude-orchestrator-dev` (a different repo). Do NOT
  edit `master/`. Everything here is the `work1` worktree on the feature branch.

## The user's vision (verbatim intent)

Voice must NOT be hardcoded phrases only. It should: talk naturally; have full visibility of
what they're working on (like Commander); reply as fast as possible using **API shortcuts**
through the orchestrator for facts, and **LLM/agent** for open-ended things; keep fast commands
for efficiency; and let them ask the agent to do *anything*. "An extension of Commander Claude."
Models must be swappable. They have an **RTX 5090 (32GB)** on their PC (real target) and this
**RTX 3080 laptop (16GB)** for testing.

---

## Part A — PR #1029 review fixes (battle-tested)

~20 bugs found via a read-only scout swarm + live end-to-end testing, each fixed with a
regression test. Highlights (see `git log`): app-server `error`-notification crash that took
down the whole orchestrator; broken respawn; a **private-repo-name leak into this PUBLIC repo**
(scrubbed the template + skill); a **supervisor auto-approve RCE path** (path-based deny
patterns); atlas quality-null, subscription re-share, non-atomic writes, machine-local config
sync conflict; discord config-merge/NaN/negation/backfill; voice realtime thread filter; several
app-server lifecycle races found by driving a real Codex thread (stop→start "Not initialized",
numeric approval id). All verified live. Full detail is in the PR description on GitHub.

---

## Part B — the voice system (newer; the focus of the last stretch)

Three layers. Read the files; they're commented.

### 1. Swappable voice-model registry — a model is DATA, not code
- `config/voice-providers.json` — the catalogue. Each provider: `{ id, kind: tts|stt|duplex,
  engine, requires: {command|env|server}, endpoint, quality, install, notes }`.
- `server/voice/voiceProviderService.js` — loads it, **health-checks** each provider (command
  present? model server reachable?), resolves the ONE active provider per capability. `auto` =
  best-quality available; `none` = off; a broken pin falls back to auto so voice never silently
  mutes. TTS health defers to speechService so they never disagree.
- `server/routes/voiceProviderRoutes.js` — `GET /api/voice-providers` (all + health),
  `GET /api/voice-providers/:kind`, `POST /api/voice-providers/:kind/active {id}`, `POST .../reload`.
- `server/speechService.js` — gained a Kokoro/generic-CLI TTS backend + Piper voice
  auto-discovery. `setActiveEngine()` is the bridge the registry calls so a swap takes effect live.
- **To add a model on the 5090:** add a config entry, install it, `POST
  /api/voice-providers/<kind>/active {"id":"..."}`. PersonaPlex/Qwen/Kokoro/Parakeet are already
  registered and light up when present. Full catalogue + install hints:
  `PLANS/2026-07-27/LOCAL_VOICE_MODELS_RESEARCH.md`.

### 2. The voice brain — routing (the "extension of Commander")
`server/voice/voiceBrainService.js`. An utterance goes through three lanes, fastest first
(wired into `voiceCommandService.processVoiceCommand` via `setBrain()`):
- **COMMAND** — a semantic command in the registry, run instantly. Natural phrasing is mapped to
  a command by the local LLM (Ollama) — e.g. "pull up the queue" → `open-queue`. Speaks a short
  confirmation.
- **FACT** — a question answerable from live orchestrator state (sessions, supervisor briefing,
  queue, discord, workspace) answered straight from a `commanderContextService` snapshot — no LLM
  turn, spoken in ms. `answerFromContext()`. An **action phrasing** ("open the queue") is guarded
  out of this lane so it isn't mistaken for a question.
- **AGENT** — anything else → forwarded to the **Commander** (full orchestrator API, can do
  anything). Acks "On it." immediately, then in the BACKGROUND watches the Commander's PTY buffer
  until it settles, extracts the assistant's prose (`extractAssistantReply` strips ANSI/TUI
  chrome), and **speaks the reply** — the two-way loop.

### 3. Local models installed + wired
- **Ollama `llama3.2:3b`** with `format:'json'` (forced JSON so a small model classifies
  reliably — this was the key fix; 1b rambled). voiceCommandService auto-detects Ollama on boot.
- **Piper** TTS as the active local voice (registry auto-selected it; swap to browser/kokoro/etc).

---

## HOW TO TEST (do this)

### Automated
```bash
cd ~/GitHub/tools/automation/agent-workspace/work1
npm run test:unit      # 859 tests; voice: voiceProviderService/voiceBrainService/voiceCommandService/speechService.test.js
node --check server/index.js
```
E2E (`npm run test:e2e:safe`) is **broken in this WSL env on main too** — Playwright+socket.io
never reports `connected`; NOT caused by this branch (proven against origin/main). Noted in
`~/.claude/projects/.../memory/MEMORY.md`. Don't chase it.

### Manual — the voice system live (instance already up on 5857)
```bash
P=5857
# fast FACT lane (instant, from live state, spoken):
curl -s -XPOST localhost:$P/api/voice/command -H 'Content-Type: application/json' -d '{"transcript":"how many agents are working"}'
curl -s -XPOST localhost:$P/api/voice/command -H 'Content-Type: application/json' -d '{"transcript":"what needs my attention"}'
# fuzzy COMMAND lane (local LLM maps phrasing -> command):
curl -s -XPOST localhost:$P/api/voice/command -H 'Content-Type: application/json' -d '{"transcript":"can you pull up the queue"}'   # -> open-queue
# swap the voice model live:
curl -s localhost:$P/api/voice-providers                                   # see all + health + active
curl -s -XPOST localhost:$P/api/voice-providers/tts/active -d '{"id":"browser"}' -H 'Content-Type: application/json'
# make it SPEAK (plays to Windows speakers via WSLg, backend=piper):
curl -s -XPOST localhost:$P/api/speech/say -H 'Content-Type: application/json' -d '{"text":"handoff test","force":true}'
```
In the browser (`http://localhost:5857`, Chrome/Edge): press **Alt+J** for the JARVIS panel;
hold **V** and speak (grant mic). The transcript pill shows what you said.

### AGENT lane needs a Commander running
The "do anything + spoken reply" lane forwards to the Commander. Start one:
```bash
curl -s -XPOST localhost:5857/api/commander/start -d '{}' -H 'Content-Type: application/json'
sleep 2
curl -s -XPOST localhost:5857/api/commander/start-claude -d '{"mode":"fresh","yolo":true}' -H 'Content-Type: application/json'
# accept the trust prompt: send "1" then "\r" via /api/commander/input
```
Then an open-ended voice request ("summarise the fleet and tell me when done") gets acked "On it."
and the Commander's reply is spoken ~4s after its output settles.

---

## LATENCY + VOICE STACK (added late in the session)

- **Restart the voice backends** with `~/.local/bin/start-voice-stack.sh` — starts Ollama
  (`:11434`, fuzzy commands) and a **warm Piper HTTP server** (`:5959`, fast TTS). Launch
  JARVIS with `PIPER_HTTP_URL=http://127.0.0.1:5959 OLLAMA_MODEL=llama3.2:3b` (see the relaunch
  command above).
- **Routing is now fast-lane-first:** rules → **fact lane** (instant, from a live snapshot) →
  LLM command classifier → agent. Measured: fact questions **~20ms** (were 8034ms — they used
  to pay the LLM cost first), fuzzy commands ~1.2s (warm model), TTS synth **~0.24s** (warm
  piper HTTP server; was ~5s spawning `python -m piper` per call). Each utterance is logged:
  `heard / route / command / reply / ms`.
- **Commander auto-starts** (`ensureCommander` in index.js) — an open-ended request no longer
  dead-ends on "no Commander"; the launch queue buffers the request through boot.
- **Commander DOES speak back:** the brain captures its PTY reply once output settles
  (`captureCommanderReply` + `extractAssistantReply`) and speaks it (~4s+ after a cold boot).

### Remaining latency/quality items
- **Command accuracy:** the 3B model sometimes picks a WRONG command ("pull up the queue" ->
  a different queue command). The fact lane is reliable; the fuzzy *command* lane is model-
  limited. Fix: a better model (e.g. `qwen2.5:7b-instruct`, fits the 16GB laptop) — pull it and
  set `OLLAMA_MODEL`. The grounding guard (`isGrounded`) blocks unrelated commands but can't
  distinguish two commands in the same family.
- **Kokoro / PersonaPlex** for a nicer / full-duplex voice — registered in the config, not
  installed. PersonaPlex serves its own browser audio (sidesteps the WSLg issue entirely).

## AUDIO ON WSL (important — the "I don't hear anything" fix)

Server-side PulseAudio (WSLg → RDPSink) reliably plays a test tone but often does **not**
reach the user's Windows speakers; **browser audio always does**. So the local neural voice
(piper) is synthesized server-side and the **WAV is streamed over the socket** (`speech-audio`
event) for the browser to play — see `speechService.speakViaPiperBrowser` +
`client/speech-output.js playAudio`. It only falls back to server-side `paplay` when no browser
client is connected. Requires the browser tab open + one prior user gesture (autoplay policy).
Caveat: the piper CLI here is `python3 -m piper` (wrapper at `~/.local/bin/piper`), which
cold-starts ~4-9s per utterance — functional but not snappy. **Responsiveness fix for later:**
keep a warm piper process, or use the piper C++ binary, or move to Kokoro/PersonaPlex.

## WHAT'S LEFT / KNOWN LIMITS

- **The 5090 models** (PersonaPlex full-duplex, Qwen omni, Kokoro/Parakeet) are registered +
  documented but not installed here (too big for 16GB). On the PC: install per the `install`
  hint in `config/voice-providers.json`, then `POST /api/voice-providers/<kind>/active`.
- **True full-duplex** (barge-in, talk over it) is the PersonaPlex/`duplex` provider — the current
  loop is turn-based (STT → route → TTS). Duplex adapter is registered (`personaplex`/`xtalk`,
  websocket to a local model server) but not yet driving audio; that's the next real build.
- **extractAssistantReply is heuristic** — it scrapes Claude's TUI buffer. Works in tests + simple
  cases; a cleaner path would be a structured output channel (the Codex app-server already gives
  `turn/completed` + transcript — using Codex as the voice agent would remove the scraping).
- **Ollama must be running** for fuzzy command matching; if it's down, voice falls back to exact
  rule phrasings only (still works, just less forgiving). Restart: `~/.local/bin/ollama serve &`.
- **Persistence:** Ollama + Piper are user-local installs; they don't auto-start on reboot. If the
  user wants them always-on, add a WSL startup hook (out of scope this session).
- The **app-server thread↔session linkage** is still dormant (documented in the design doc) — the
  supervisor runs on PTY signals; structured Codex signals need a session→threadId link.

## Cleanup note
Temp files under `/tmp/pr1029-*` and `/tmp/ollama-*` are throwaway. The isolated data dir
`~/.agent-workspace-jarvis-test` and the Ollama/Piper installs under `~/.local` are intentional
(the working local voice stack) — keep them.

---

## SESSION 2 UPDATE (2026-07-27, later) — natural voice + routing hardening

Continued the same branch. **Tests now 868 green / 120 suites.** All changes committed + pushed.

### 1. Kokoro natural voice — INSTALLED and ACTIVE (supersedes the "not installed" note above)
- `kokoro-onnx` installed; a warm Flask HTTP server at **:5960** (`~/.local/bin/kokoro-server.py`)
  keeps the model loaded (POST `/synthesize` → WAV, voice `af_sarah`, ~2s CPU synth).
- `config/voice-providers.json` kokoro is now `engine:kokoro, quality:5, requires.server:5960`.
  `speechService` streams its WAV to the browser exactly like piper (WSL audio fix). Kokoro is the
  resolved active TTS (verified: `GET /api/voice-providers` → `active.tts.resolved = kokoro`).
- **Piper is also warmed** now: HTTP server at **:5959** (`python3 -m piper.http_server`), ~0.2s
  synth vs the old ~5s cold `python -m piper`. `synthAndEmit` hits the warm server first.
- **Start the whole voice stack** (ollama + warm piper + warm kokoro), idempotent:
  `bash ~/.local/bin/start-voice-stack.sh`

### 2. Routing hardening — bugs found by live stress-testing, all fixed + unit-tested
Verified live via `POST /api/voice/parse` (classifier only, no side effects). All now 50-72ms:
- **Negations no longer do the opposite.** `"don't open the queue"` used to be classified into a
  queue command; now short-circuited to the Commander (`voiceCommandService.parseCommand`).
- **Dismissals ack instantly.** `"never mind"` / `"actually never mind"` → "Okay, forget it."
  (was a Commander round-trip; the action guard had been swallowing the leading "never").
- **Stray single words skip the LLM.** `"uh"` → "didn't catch that" instantly (was ~900ms).
- **`open the <panel>` is rule-matched**, not LLM-guessed. `"open the queue"` was misfiling as
  `queue-select-by-pr-ref` on the 3b model; added deterministic rules for open-queue / open-tasks
  / open-advice / open-settings (they require their object noun, so they don't shadow the specific
  queue rules like "open blockers" / "triage queue").
- **Natural fleet-status questions** (`"how's the fleet doing"`) now hit the instant fact lane
  instead of the Commander.
- **Default LLM is now `llama3.2:3b`** (was silently using 1b even when 3b was installed — the
  model-preference check matched any llama3.2 tag). Selection degrades gracefully to the best
  installed model (qwen/3b before 1b/phi).

### 3. Live server as left
- **JARVIS running on :5857** from this worktree (`work1`), env: `ORCHESTRATOR_PORT=5857
  AGENT_WORKSPACE_DIR=~/.agent-workspace-jarvis-test OLLAMA_MODEL=llama3.2:3b
  PIPER_HTTP_URL=http://127.0.0.1:5959 KOKORO_HTTP_URL=http://127.0.0.1:5960`. It serves its own
  UI at `http://localhost:5857`. It is a **static node process** (not nodemon) — code changes
  need a manual relaunch (kill the pid on :5857, re-run with the same env). Log: `/tmp/jarvis-server.log`.

### Still open (unchanged, lower priority)
- Genuine gibberish (`"purple monkey dishwasher"`) still routes to the Commander (~0.8s) — the
  Commander just says it doesn't understand. Reliable gibberish detection isn't worth the
  false-reject risk on real requests.
- Multi-part commands (`"open the queue AND approve everything"`) execute the first clause only.
- True full-duplex (PersonaPlex on the 5090) is still the next real build — see above.

---

## SESSION 3 UPDATE (2026-08-05) — full-PR review pass (Fable) + fixes

Re-reviewed the whole PR: 7 read-only subsystem scouts + an independent Codex pass over the
unreviewed 07-27 voice commits; every finding verified against the actual code before fixing.
**Tests now 893 green / 120 suites** (was 868). Nine fix commits, all pushed.

Fixed, worst first:
- **voice CRITICAL** — rules matched BEFORE the negation guard and destructive rule patterns are
  unanchored: `"don't stop all claudes"` actually executed `stop-all-claudes` (verified live).
  Negation now short-circuits rule matching. Also: "stop the server" no longer swallowed as a
  negation; `/what.*sessions/` no longer steals fact questions; `isGrounded` requires the
  destructive VERB, not an incidental noun; Commander-reply captures serialized (shared-buffer race).
- **supervisor CRITICAL** — auto-approve deny list was case-sensitive (`Write(.ENV)`, lowercase SQL
  passed) and only knew `~/`-style credential paths (`Write(/home/x/.ssh/...)` auto-approved).
  Deny patterns compile case-insensitive now; absolute `/home|/Users|/root` credential paths,
  quoted build-file paths and `git push -f` denied. `forgetHealed` clears cooldowns (stale cooldown
  blocked action on fresh recurrences + unbounded map); `reload-rules` writes an audit entry.
- **speech** — kokoro was hardcoded "available" (URL has a default) with a silent no-op failure
  path: a dead kokoro server muted the voice permanently while `speak()` reported success.
  Availability is now an explicit signal (env set / registry-verified); failed neural synth falls
  back to browser speech; TTS `none` actually mutes; priority reaches the streamed-audio path;
  client queues clips instead of overlapping, respects mute, and replays autoplay-blocked audio on
  the first user gesture.
- **atlas** — `compile()` re-shared a teammate's subscribed highlights once the repo also appeared
  in local discovery (cloning it declassified their content). Bundles now merge WITHOUT the
  subscription layer (`getOwnEntries`). Also: `writeManifest` knows `main/` checkouts; CLI
  value-less `--topic` rejected; `qualityFloor` boolean guard.
- **app-server** — stdio pipes had no error listeners (a non-EPIPE stream error would take down the
  whole orchestrator); restart backoff reset at spawn, so a spawn-then-die binary was hammered at
  the 1s floor forever (resets only after 30s uptime now); an undelivered approval answer keeps the
  approval pending instead of vanishing.
- **discord** — permalinks always rendered the DM-only `/channels/@me/...` form (guild id now
  fetched once per channel + cached); backfills >100 silently capped at 100 (now page `before=`
  backward); channels added over the API now persist to the override config; `linkSession` awaits
  its task-record write (its catch was dead code); `numberOr(null)` falls back instead of becoming
  0; explicit `tier: 0` honored.
- **privacy** — files NEW in this PR (the design doc, COMMANDER_CLAUDE.md examples, atlas test
  fixtures) shipped real private repo names into this public repo; scrubbed to the established
  `acme-*` placeholder vocabulary. Names remain in this branch's earlier commit history;
  pre-existing references on main are left as a separate decision.

Consciously left as-is: `POST /api/atlas/proposals` stays read-level (agents must be able to
propose; approving is what writes and stays write-gated); `speech-speak`/`speech-audio` are
fleet-wide broadcasts by design (two open browser windows will both narrate);
`extractAssistantReply` remains heuristic (the structured replacement is the Codex app-server
path); `package.json` `engines >=16` predates this PR even though server code now uses fetch —
Node 18+ is the real floor.
