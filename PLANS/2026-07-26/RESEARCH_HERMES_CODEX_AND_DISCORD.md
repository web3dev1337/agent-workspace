# Research: Hermes Agent, the Codex app-server, and the Discord rebuild (2026-07-26)

Three questions, one conclusion: the most valuable thing found here is not a product to adopt,
it is a **protocol we can already speak**.

---

## 1. The Codex finding (this is the important one)

`openai/codex` is **Apache 2.0 and open source**, and the CLI already installed on this machine
ships a component called `codex app-server`. From its own README:

> Similar to MCP, `codex app-server` supports bidirectional communication using JSON-RPC 2.0
> messages. Supported transports: stdio, websocket, unix socket.

This is the interface that powers the Codex VS Code extension and the Codex app. It is documented,
versioned (`v1`/`v2` protocol modules), and speakable by anything that can write JSON lines.

### What it exposes that we currently guess at

The supervisor today infers agent state by regex-scraping terminal output — "Do you want to
proceed" means a permission prompt, a cost line means a turn ended. The app-server emits these as
**structured events**:

| We currently scrape | app-server emits |
|---|---|
| "Do you want to proceed?" | `item/commandExecution/requestApproval` |
| Cost/summary line = done | `turn/completed`, `item/completed` |
| Busy/idle heuristics on buffer growth | `thread/status/changed` |
| Nothing — invisible to us | `thread/tokenUsage/updated` |
| Nothing — invisible to us | `turn/plan/updated`, `turn/diff/updated` |
| Guessed from banner text | `account/rateLimits/updated` |

Every one of those is a supervisor signal we are currently reconstructing unreliably from a byte
stream. Approval prompts in particular: instead of pattern-matching prose that changes between
releases, we would receive the actual command and answer it over the wire.

### And the voice pipeline is right there

```
thread/realtime/start        thread/realtime/appendAudio      thread/realtime/outputAudio/delta
thread/realtime/appendText   thread/realtime/transcript/delta thread/realtime/transcript/done
thread/realtime/listVoices   thread/realtime/sdp              thread/realtime/stop
```

`sdp` means WebRTC. This is the full-duplex voice OpenAI shipped to the Codex desktop app on
2026-07-23 — the same thing described as "orchestrate multi-threaded coding jobs by voice" — and it
is addressable locally.

### Answering the three questions directly

1. **Is there an API?** Two. The **Codex SDK** (TypeScript and Python) embeds the agent in your own
   app. The **app-server protocol** drives a local Codex the way the official app does. Codex CLI
   can also run as an MCP server.
2. **Can we reverse-engineer it?** No need. It is Apache 2.0 with the protocol documented in-repo.
3. **Can we do broader/better?** Yes, and this is the actual opportunity. **The Codex app is
   Codex-only, and macOS-only.** Ours is agent-agnostic and cross-platform. So:

> **Speak app-server for Codex sessions to get structured signals; keep PTY scraping as the
> universal fallback for Claude, Gemini, aider and anything else. One supervisor, best-available
> signal per agent.**

That is a strictly better position than either product: OpenAI cannot generalise to Claude, and we
would not be throwing away the agent-agnostic layer to get the fidelity.

### Cost note

The app-server drives the **local Codex CLI**, which bills the Codex subscription — the same
"drive the CLI, don't call the API" property the rest of this system relies on.

### Recommended next step

An adapter seam in the supervisor: `signalSource: 'app-server' | 'pty'` per session, resolved from
the agent registry. PTY stays the default and the fallback; nothing regresses if the app-server is
unavailable. Sized at roughly a day, and it upgrades every condition in the rule table at once.

---

## 2. Hermes Agent — worth knowing, not worth adopting

[Hermes Agent](https://hermes-agent.nousresearch.com/docs/) (Nous Research, MIT, launched 2026-02-25)
is model-agnostic and self-hostable on Linux, macOS, WSL2, Windows and Android/Termux. It runs as a
CLI, a desktop app, an **OpenAI-compatible API server**, and a **gateway across 20+ messaging
platforms** — Telegram, Discord, Slack, WhatsApp, Teams. It works with Nous Portal, OpenRouter,
OpenAI, Anthropic, Gemini, DeepSeek, Qwen, or any OpenAI-compatible endpoint including Ollama.

**Can Codex run it?** Not in the sense of "Hermes powered by your Codex subscription". Hermes wants
an OpenAI-compatible `/v1/chat/completions` endpoint; the Codex CLI is not one. You could put a
proxy in between, but then you are paying per token through whatever the proxy talks to, which
throws away the subscription-billing advantage that makes continuous autonomy affordable here.

**Is it still beneficial?** Two things about it are genuinely interesting, and neither requires
adopting it:

1. **The messaging gateway.** 20+ platforms with one integration is real engineering we would not
   want to redo. If the Discord bridge ever needs to become a Slack/Telegram/WhatsApp bridge, look
   here first — as a component, behind our own work model.
2. **The self-improving skill loop** (agent-curated `MEMORY.md`, skills it writes and then refines
   during use). That is the same instinct as Atlas write-back: the system recording what it learned
   so the next run starts smarter. Worth stealing as a pattern.

**What is not useful:** its agent runtime. We already have one, and ours knows what a worktree is,
what tier a task is, and which PR is waiting on evidence. Running a second runtime that knows none
of that adds a process without adding capability.

**Verdict: no.** Revisit only if multi-platform messaging becomes the requirement.

---

## 3. Discord: what is wrong and what replaces it

### What exists today

`server/discordIntegrationService.js` is a **file-drop queue**. An external bot repo writes
`~/.claude/discord-queue/pending-tasks.json`; the orchestrator ensures a Services workspace and
sends a processing prompt to a Claude terminal. It has real hardening (signed queue verification,
idempotency keys, an audit log) but the *shape* is wrong:

- **It only sees what was explicitly queued.** Someone has to address the bot. Ordinary conversation
  — which is where the actual assignments happen — is invisible.
- **A restart loses whatever arrived while it was down.** There is no cursor and no backfill.
- **Hardcoded paths** to another repo's queue directory.
- **It runs on one laptop**, so "is the bot up?" is a question with a real answer.

### The team-coordination gap underneath it

The tooling is Discord + Trello + GitHub, and between them nothing answers:

- What is the **priority** of what I just asked someone to do?
- Is anyone **working on it**, right now?
- Is their **agent** running, or did they forget to prompt it?
- Did a ticket ever get **created**?
- Did the work **land**?

Every one of those is knowable — the orchestrator already knows session status, tier, branch, and PR
state — it is just never published anywhere the team can see.

### The replacement, in three parts

**a) Durable ingest, cursor-based.** Poll `GET /channels/{id}/messages?after={lastSeenId}` instead
of holding a gateway socket. This is the fix for "it couldn't pick up what it missed", and it is a
fix by *construction* rather than by retry logic: there is no such thing as a missed message when
your read position is persisted. A restart after three days is just a longer page-through. Polling a
team chat every 10 seconds is entirely adequate and removes a whole class of connection-state bugs.

**b) Ambient extraction.** Read every message, not just mentions. A cheap rule pass finds the
obvious cases (a mention plus an imperative, a question directed at someone, a link to a PR or
card). Only the ambiguous middle goes to a model, batched — same rules-first/LLM-on-event economics
as the supervisor. Output is a **work item**: who, what, priority, source message, permalink.

**c) Status publishing — the part that closes the loop.** When a session picks up a work item, the
orchestrator posts back to the thread. When the branch pushes, when the PR opens, when it merges.
Nobody types a status update; the status *is* the system's own knowledge, published. "Is their agent
working on it" stops being a question you have to ask.

### Where does it run, and on whose computer

Honest answer: **it does not need a VPS to start, and it should not start with one.**

- The **ingest is stateless given its cursor.** Whoever's orchestrator is designated the hub polls
  and publishes. If that machine sleeps, nothing is lost — it catches up on wake. That is a very
  different failure mode from a dropped gateway connection.
- **Everyone else's orchestrator only publishes its own status**, which needs no inbound
  connectivity at all.
- The upgrade path, if and when the hub machine being asleep becomes annoying: move *only* the
  ingest and cursor to a cheap always-on box. It is a poller with a JSON file. The agents stay on
  the machines that have the code and the credentials — those never move, because that is where the
  work is.

Deliberately **not** proposed: a shared server that runs agents. Auth doesn't travel, worktrees
don't travel, and the moment the brain is remote you are proxying every signal it needs back to it.

---

## 4. What this changes about the roadmap

1. **Discord ambient ingest + work items + status publishing** — replaces the file-drop queue.
2. **App-server adapter for Codex sessions** — upgrades every supervisor condition at once by
   replacing scraped signals with structured ones. Highest ratio of capability to effort on this
   list.
3. **Realtime voice via `thread/realtime/*`** — full-duplex voice for Codex threads, using the same
   pipeline OpenAI shipped, without being locked to their app or to macOS.
4. **Atlas write-back** (agents propose highlights from work they just did) — the Hermes
   self-improving-skills idea, applied to the map.

## Sources

- [openai/codex](https://github.com/openai/codex) — Apache 2.0; `codex-rs/app-server/README.md` documents the protocol
- [Codex SDK](https://developers.openai.com/codex/sdk) · [Codex with the Agents SDK](https://developers.openai.com/codex/guides/agents-sdk)
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- [VentureBeat — GPT-Live full-duplex voice control comes to Codex](https://venturebeat.com/orchestration/agentic-coding-goes-hands-free-as-openai-brings-gpt-lives-full-duplex-voice-control-to-codex-and-chatgpt-on-the-desktop)
- [Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/) · [AI providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)
- [Hermes Agent vs OpenClaw comparison](https://contabo.com/blog/hermes-agent-vs-openclaw-paperclip-and-the-best-open-source-ai-agents-in-2026/)
