# Autonomous Orchestrator, Voice, and the Repo Atlas (2026-07-26)

Three asks, investigated together because they are the same product:

1. **A top-level orchestrator** that checks in on agents, stops them getting stuck, and proactively picks up work.
2. **Voice** as the primary way to talk to it.
3. **A cross-repo map** — `CODEBASE_DOCUMENTATION.md` but for *every* repo, with per-teammate access scoping, so agents get breadcrumbs ("how did we do data compression?") without a filesystem safari.

---

## 0. The one architectural decision that makes all of this affordable

> **Do not run an LLM in a loop. Run *rules* in a loop and wake an LLM on an event.**

This is the answer to "I'm worried about how I'd run it and what it costs."

A supervisor that polls 16 sessions every 30s and asks a model "is this stuck?" burns money forever and produces nothing when nothing is happening. Instead:

| Layer | Runs | Cost |
|---|---|---|
| **Sensors** — PTY tail, status detector, git state, PR state, task records | every tick (30s) | **0 tokens.** Pure JS, already in-process. |
| **Rules** — a data-driven condition table (`config/supervisor-rules.json`) | every tick | **0 tokens.** Regex + timers. |
| **Actions** — nudge text, approve prompt, `gh pr create`, notify, speak | on match | **0 tokens.** PTY writes + shell. |
| **Judgement** — "what should we do about this?", free-form voice, briefings | on escalation only, debounced | Cheap. Local Ollama first, Haiku second. |
| **Agentic work** — actually fixing the thing | on your say-so | **Subscription, not API.** |

That last row deserves emphasis, because the premise in the ask is worth correcting:

**You do not need Anthropic API credits to have an autonomous Claude.** OpenClaw/Hermes-style assistants call the *API*, so they cost per token. This orchestrator does something different — it drives the **Claude Code CLI inside a PTY**, which bills against your Max subscription like any interactive session. The supervisor writing `next\r` into a stuck session is exactly as expensive as you typing it. That is already how `pagerService` works today. So the autonomy budget is: **~$0 for the watching, subscription for the doing.**

The only genuinely metered pieces are the optional judgement calls (intent haiku, voice fallback parsing). Those are already Ollama-first in `voiceCommandService`, and stay that way.

### Where it runs

On your machine, inside the orchestrator server process. Not a VPS, not a container, not a hosted service. Reasons:

- The state it needs to supervise (PTYs, worktrees, session buffers, `~/.agent-workspace`) is *here*. A remote brain would have to proxy all of it back.
- The actions it takes (write to PTY, run `gh`, create worktrees) are local.
- Your agent CLIs are authenticated here. Auth doesn't travel.
- It's already a long-lived process you keep running.

If you later want to *reach* it from your phone, that's a thin remote-control surface over the existing HTTP API (the mobile/LAN path already exists in `scripts/mobile/start-mobile.sh`) — not a second brain.

---

## 1. Build vs. buy: OpenClaw / Hermes Agent

Both are real and both are good, and neither is the shape of this problem.

**[OpenClaw](https://openclaw.ai/)** (Peter Steinberger; was ClawdBot → Moltbot → OpenClaw after Anthropic raised a naming concern) is a self-hosted **multi-channel personal assistant** — you message it on WhatsApp/Telegram/Discord/iMessage and it does things on your machine. Enormous adoption. Its centre of gravity is *reach*: getting an agent into the chat app you already have open.

**[Hermes Agent](https://contabo.com/blog/hermes-agent-vs-openclaw-paperclip-and-the-best-open-source-ai-agents-in-2026/)** (Nous Research) is a model-agnostic **headless agent runtime** meant to sit on a VPS and pair with any provider. Its centre of gravity is *server-side footprint and scriptability* — smaller surface area, less setup noise than OpenClaw.

Neither knows what a worktree is, what tier a task is, that PR #1022 is waiting on evidence, or that `work3` has been sitting on a permission prompt for four minutes. That domain model — **sessions, worktrees, tiers, queue, review inbox, evidence, task records** — is the entire value here, and it already exists in this repo. Rebuilding it inside OpenClaw would be most of a rewrite; bolting OpenClaw on top would give you a chat interface to an orchestrator that still can't see anything.

**Verdict: build the supervisor here.** Steal the good idea from OpenClaw — *reach* — later, as a notification/remote-control channel (Discord bridge already half-exists in `discordIntegrationService`), not as the brain.

---

## 2. What "top-level orchestrator" actually means

Today the fleet is **pull-based**: you look at the grid, you notice something is stuck, you fix it. Every existing mechanism is either blind or manual:

- `pagerService` — nudges on a fixed interval regardless of whether anything is wrong. Blind.
- `schedulerService` — runs commands on a clock. Blind.
- `processAdvisorService` — computes good advice, but only when a human opens the panel. Passive.
- `statusDetector` — knows busy/waiting/idle per session, but nothing consumes it to *act*.

The missing piece is a **push-based supervisor**: something that continuously classifies each session's condition and takes graduated action. Shipped in this branch as `server/supervisorService.js`.

### Conditions detected

| Condition | Signal | Default action |
|---|---|---|
| `awaiting-permission` | prompt pattern in PTY tail, held > threshold | notify → (autopilot) auto-accept safe prompts |
| `stalled` | status `busy` but no new output for N min | nudge (one-shot pager ping) |
| `idle-finished` | idle + clean tree + nothing to do | notify — free capacity, offer next queue item |
| `unpushed-work` | idle + commits ahead of origin | nudge "commit/push and open a PR" |
| `pushed-no-pr` | branch on origin, no open PR | nudge → (autopilot) `gh pr create` |
| `pr-awaiting-review` | open PR with evidence | route to review inbox / start review chain |
| `limit-reached` | usage-limit banner in tail | schedule resume at the parsed reset time |
| `error-loop` | same error line N times | escalate to human. Never auto-act. |
| `crashed` | agent exited, shell prompt returned | notify → (autopilot) relaunch with resume |

### The escalation ladder

Every condition resolves to one rung, and the rung is capped by a global autonomy level:

```
observe → notify → nudge → act → escalate(human)
             ↑                        ↑
    autonomy: assist          always available
```

- `off` — nothing runs.
- `observe` — findings recorded and visible; zero side effects. **Default.** Run it for a week and read the log before you let it touch anything.
- `assist` — may notify, speak, and nudge (text into a session). Cannot run commands.
- `autopilot` — may also take listed `act` steps.

Hard invariants regardless of level:
- **Never** auto-act on anything matching the scheduler's blocked-command patterns (merge, approve, stop-session, remove-worktree, destroy).
- **Never** auto-answer a permission prompt whose command isn't on the allowlist.
- Every action is appended to `~/.agent-workspace/logs/supervisor-audit.jsonl` with the finding that caused it.
- Per-session cooldowns; a finding that re-fires does not re-act.

### Why this is the Iron Man bit

The Jarvis experience isn't a nicer chat box — it's that **the assistant noticed first**. "Sir, `work3` has been waiting on a file-write permission for four minutes, and `zoo-game/work1` pushed eleven minutes ago without opening a PR." That is entirely a sensors-and-rules problem, and it is now solved with zero tokens.

---

## 3. Voice

Already present: `whisperService` (local STT: whisper.cpp / openai-whisper) and `voiceCommandService` (rule-based intent parse → `commandRegistry`, Ollama/Haiku fuzzy fallback). Two things were missing, both shipped here:

**Speech out** — `server/speechService.js`, pluggable and degrading gracefully:
`browser` (Web Speech API — zero install, the default) → `piper` (local neural, best offline quality) → `say` (macOS) → PowerShell SAPI (Windows) → `espeak-ng`.
The browser backend matters: it means voice output works on a fresh clone with nothing installed, which is the difference between a feature people use and a feature people mean to set up.

**Free-form routing** — previously an utterance that matched no pattern was a dead end. Now anything unmatched is forwarded to the Commander agent as a prompt. That single change converts voice from a *command remote* into a *conversation*, because the fallback is a full agent with the whole API surface rather than an error beep.

Plus: `briefing` (spoken fleet summary assembled from supervisor findings + advisor output) and optional spoken announcements when the supervisor escalates.

---

## 4. The Repo Atlas

### The problem, stated precisely

232 GitHub repos. 28 cloned locally. When starting anything new, the useful instinct is *"go see how we did X in Y"* — but that requires you to remember that Y exists and did X well. So you tell the agent, and if you forget, the knowledge is simply lost. Meanwhile an agent asked to find it cold burns thousands of tokens grepping a filesystem that doesn't even contain most of the repos.

`CODEBASE_DOCUMENTATION.md` solved this *inside* one repo. The Atlas is the same idea one level up.

### Three properties that make it work

**1. Cloned-ness is irrelevant.** An entry describes a repo whether or not it's on this disk. `drain-the-lake` can be a first-class breadcrumb with a clone hint attached. This is the whole point — the map must cover the territory, not the local cache of it.

**2. Quality is a first-class field, per-topic.** The ask is explicit and correct: Epic Survivors and HyFire2 are early work but *fully functioning*, and Drain the Lake is a rough prototype that might still have the best testing setup you've written. So quality is not a repo-level star rating; it's **per highlight**:

```jsonc
"highlights": [
  { "topic": "testing",   "quality": 5, "paths": ["tests/"], "notes": "best harness we have" },
  { "topic": "worldgen",  "quality": 2, "notes": "prototype spaghetti — read for ideas, not patterns" }
],
"avoid": [ { "topic": "ui", "reason": "hand-rolled, superseded by roblox-game-kit" } ]
```

A repo can be simultaneously "don't copy this" and "copy exactly this one thing", which is the truth about real codebases and something a flat rating cannot express.

**3. Sharing is subtractive and per-audience.** You own repos your team can't see; teammates differ from each other. So the master atlas lives locally and *compiles down* to audience bundles:

```
~/.agent-workspace/atlas/atlas.json        # master — private, never shared
        │  compile --audience core-team
        ├─► atlas.core-team.json           # entries visible to core-team
        ├─► atlas.contractors.json         # a strict subset
        └─► atlas.public.json              # public repos only
```

Each entry carries `visibility` (`private|team|public`) and `groups: [...]`. A bundle contains an entry only if the audience is in its groups. Two escape hatches:
- `redact: ["notes","paths"]` — list the repo as existing, hide the internals. Useful for "yes we have a payments service, no you can't see how."
- Group-scoped highlight overrides — the same repo can expose different highlights to different audiences.

**Stated plainly, because it matters:** the bundle is *metadata distribution*, not access control. GitHub permissions are the enforcement. Anything in a bundle should be treated as readable by everyone in that audience. The compiler's job is to make it impossible to leak by accident, not to make leaking cryptographically hard.

### Where entries come from

Layer 1 — **in-repo manifest**, `.repo-atlas.json`, committed. The repo describes itself; it travels with the code; the agent working in that repo maintains it (same discipline as `CODEBASE_DOCUMENTATION.md`).

Layer 2 — **central registry**, `~/.agent-workspace/atlas/registry.json`. Curated entries for repos with no manifest (forks, references, archived, never-cloned). This is where you write "drain-the-lake: rough, but the testing is worth reading."

Layer 3 — **auto-discovery**, zero-effort baseline. Scan `~/GitHub` for git repos + `gh repo list` for the rest; infer kind, language, activity, fork/archive status. Produces a draft you curate rather than a blank page. Curated fields always win over inferred ones.

### How an agent uses it

The token-efficiency argument is the point, so the primary interface is a **digest**, not a search:

```
$ atlas digest --topics
roblox/luau   box2d-luau(physics:5, testing:5) roblox-game-kit(mechanics:4) sabot-fps(fps-net:3)
hytopia       zoo-game(data-compression:5, worldgen:4) hyfire2(matchmaking:3 ⚠ old)
monogame/c#   epic-survivors(save-system:4 ⚠ old) beat-em-up-engine(input:4)
```

Paste that into a prompt (or a `CLAUDE.md`) and the agent *has the map* — it never needs to search to know that `box2d-luau` is where the good tests live. Then `atlas show box2d-luau` for detail and `atlas find testing --min-quality 4` when it needs to look sideways.

Surfaces shipped: standalone CLI (`scripts/atlas.js`, no server required — symlink into `~/.claude/scripts/`), orchestrator REST API (`/api/atlas/*`), and an agent skill so any Claude/Codex session can query it without being told how.

### Which repos this belongs in

- **This repo (agent-workspace)** — the engine: schema, service, CLI, API, compiler. Public and open-source, so it ships with *zero* personal data; an example manifest only.
- **`~/.claude` (ai-claude-standards)** — the CLI symlink + skill, so every agent on the machine can query the atlas whether or not the orchestrator is running.
- **Your data** — `~/.agent-workspace/atlas/`, local, gitignored by construction.
- **Team distribution** — compiled bundles into whichever shared repo that audience already has access to (`agents-*` repos per the existing bootstrap/sync scripts).

---

## 5. What shipped (PR #1029)

All three, on `feature/autopilot-voice-and-repo-atlas`. 709 unit tests green (was 652).

| Piece | Where | State |
|---|---|---|
| Supervisor loop | `server/supervisorService.js`, `server/supervisor/*` | Running, autonomy `observe` |
| Condition table | `config/supervisor-rules.json` | 8 conditions, none reaching `act` |
| Speech out | `server/speechService.js`, `client/speech-output.js` | Browser backend active |
| Free-form voice | `server/voiceCommandService.js` (`setCommanderForwarder`) | Wired to Commander |
| Repo Atlas | `server/repoAtlasService.js`, `server/atlas/*`, `scripts/atlas.js` | 233 repos mapped, 25 cloned |
| APIs | `server/routes/{supervisor,speech,atlas}Routes.js` | Policy-gated, live-verified |
| Commander docs | `docs/COMMANDER_CLAUDE.md` | All three surfaces documented |
| CLI + skill | `~/.claude/scripts/atlas.sh`, `~/.claude/skills/repo-atlas/` | Installed, on PATH |

Verified live rather than only in tests: supervisor status/tick/briefing, speech status/say, atlas
status/find/digest/compile, and the autonomy-level guard, all against a running server on a scratch
port. Sharing checked end to end by compiling `core-team` and `contractors` from one registry and
confirming differential redaction, no private entries, and no local paths in the output.

### Seeded atlas state

Only highlights with actual evidence behind them were recorded — `box2d-luau` (physics, testing) and
`roblox-mechanics-encyclopedia` (architecture), all sourced from the repos' own descriptions. **No
quality scores were invented for the other 230.** The map is built; the judgement is deliberately
left to you, because a fabricated 4/5 is worse than a blank field — it sends agents somewhere on a
false promise.

## 6. What is left

Everything scoped in section 5 and in `RESEARCH_HERMES_CODEX_AND_DISCORD.md` has shipped:
the fix-first supervisor, git-backed Atlas sync, ambient Discord tracking, the Codex
app-server adapter, realtime voice, Atlas write-back, and the JARVIS panel.

What genuinely remains is operational rather than unbuilt:

1. **Point the Atlas registry at a private repo** — `atlas remote set <git-url>` then
   `atlas sync`. Until that runs, the map is still single-machine.
2. **Curate.** 233 repos are mapped; only a handful are scored. `atlas note` when you know
   something, and approve the proposals agents file as they work.
3. **Set `DISCORD_BOT_TOKEN` and add channels** to turn the ambient watcher on.
4. **Set `CODEX_APP_SERVER=true`** to get structured Codex signals in place of scraping.
5. **Read a week of `supervisor-audit.jsonl`** and tune. The defaults are opinions —
   interruption threshold, tier weights and `escalateAfterAttempts` are the dials.

Known limits, stated plainly:

- The raw-audio realtime path (`appendAudio`) is wired but its PCM framing is unverified
  against a live authenticated session. The text path is the default and works.
- Structured signals only cover Codex. Claude, Gemini and aider stay on PTY scraping —
  which is why the scraper remains the universal fallback rather than being removed.
- Discord extraction is rules-only. The `classifier` seam for handing ambiguous messages
  to a cheap model exists but is unused.
