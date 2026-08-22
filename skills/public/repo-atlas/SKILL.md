---
name: repo-atlas
description: Query the Repo Atlas — a map of every repo the user owns, cloned or not, with per-topic quality scores. Use whenever you need prior art ("how did we do networking/save data/testing before?"), when starting a new project and want to reuse an existing approach, when the user says "I remember doing this somewhere", or when you would otherwise grep the filesystem looking for a repo. Also use to record what a repo turned out to be good at.
allowed-tools: Bash, Read
---

# Repo Atlas

One queryable map of every repo the user owns — including repos that are **not cloned on this machine**. Ask it before searching the filesystem.

## Why this exists

There are hundreds of repos. Grepping `~/GitHub` finds only the fraction that happen to be cloned, costs thousands of tokens, and cannot tell you that a scruffy prototype has the best test harness in the collection. The atlas answers both "where is it?" and "is it worth copying?".

## The one command that matters

```bash
atlas find <topic>          # who did this well, and where in the repo
```

Example:
```bash
$ atlas find data-compression
5/5  acme-tycoon
     bitpacked player save — 12x smaller than the JSON we started with
     paths: src/data/packSave.ts
     ~/GitHub/acme-tycoon
```

Results are ranked by quality (1–5, recorded **per topic**), and repos the user has explicitly marked do-not-copy for that topic are excluded. `⚠old` means untouched for over a year — still readable, just check it against current conventions.

## Reading the map

```bash
atlas digest                        # compact whole-map overview — cheap, paste-able
atlas topics                        # every topic anyone has recorded, and who has it
atlas show <id>                     # everything known about one repo
atlas list --platform roblox --no-forks
atlas find testing --min-quality 4
```

`atlas digest` is the right first call when you want orientation rather than an answer. It is deliberately terse:

```
roblox   physics-kit(physics:5, testing:5) puzzle-proto(testing:4 ⚠old)
example  acme-tycoon(data-compression:5, worldgen:4)
```

## Not cloned? Still useful

An entry with `remote` instead of a local path exists only on GitHub. That is fine — read it without cloning:

```bash
gh api repos/<owner>/<repo>/contents/<path> --jq '.content' | base64 -d
gh repo clone <owner>/<repo> /tmp/<repo> -- --depth 1   # if you need the whole thing
```

Never clone into the user's `~/GitHub` tree to "just take a look" — use `/tmp`.

## Recording what you learn

**Do this at the end of any substantial piece of work.** If you built something genuinely reusable, or discovered that a repo's approach to something is excellent or awful, propose it. This is the single thing that keeps the map alive instead of letting it rot.

```bash
atlas propose <repo-id> --topic <topic> --quality 1-5 \
  --paths src/a.ts,tests/ \
  --notes "why it is worth copying" \
  --evidence "what you actually saw that supports this" \
  --by "<your session id>"

atlas propose <repo-id> --topic <topic> --avoid --notes "why nobody should copy this"
```

Proposals wait for the user to approve — **you cannot write to the map directly, and should not try.** That is deliberate: if agents wrote freely, every repo anyone touched would end up rated 5/5 and the quality scores would stop meaning anything.

Always fill in `--evidence`. "40 tests added in tests/unit, all green" is reviewable in two seconds; "it's good" is not, and will be rejected.

If the user is curating directly, `atlas note` / `atlas avoid` write immediately — those are for them, not for you.

Guidance on scores: **5** = copy this exactly; **4** = solid, adapt it; **3** = works, read for ideas; **2** = only if nothing better; **1** = cautionary example. Score the *topic*, not the repo — a prototype can be a 5 at one thing and a 2 at everything else.

Use `atlas topics --vocabulary` for canonical topic names. Aliases fold automatically (`multiplayer` → `networking`, `tests` → `testing`), and unrecognized topics are kept rather than dropped.

## Describing a repo from inside it

If you are working in a repo with no `.repo-atlas.json`, create one and commit it:

```bash
atlas init .        # seeds from what discovery already knows
```

Then fill in `summary`, `highlights`, and `visibility`. Treat it like `CODEBASE_DOCUMENTATION.md`: update it when the repo gains or loses something worth pointing at.

## Sharing (be careful here)

Entries are **private by default**. Compiled bundles are what get shared with teammates:

```bash
atlas audience list
atlas compile <audience> --dry-run --explain    # always dry-run first
```

- `visibility: public` — in every bundle.
- `visibility: team` — only for audiences named in its `groups`.
- `visibility: private` — never shared, overrides groups.
- `visibility: encrypted` — in every bundle too, but sealed to that repo's own key (`.repo-atlas-key`, committed inside the repo it protects). Decrypting it needs GitHub access to the repo, not audience membership — someone can read the bundle file and still see nothing but ciphertext for these entries. `atlas key generate <id>` creates the key on first `atlas compile`/`publish` for a cloned `encrypted` entry; a teammate who was just given repo access runs `atlas key sync` to pull it via `gh api`.

Never change a repo's `visibility` or `groups` on the user's behalf. Bundles are metadata distribution, not access control — GitHub permissions are the real boundary. `encrypted` visibility adds a second, cryptographic lock on top of that; it is not a substitute for it, and rotating a leaked key (`atlas key generate --rotate`) does not un-decrypt bundles someone already pulled.

## Setup

If `atlas` is not on PATH, run it directly: `node <agent-workspace>/scripts/atlas.js <command>`.
If it reports no repos, the map has never been built: `atlas scan`.
The orchestrator exposes the same data at `GET /api/atlas/find?topic=...`, `/api/atlas/digest`, `/api/atlas/entries`.
