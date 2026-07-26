# Local real-time voice models — research + integration plan (2026-07-27)

Goal: full-duplex, back-and-forth, **local** voice for JARVIS, with models swappable at
runtime. Target hardware: **RTX 5090, 32 GB** (the real deployment) and an **RTX 3080
Laptop, 16 GB** (for testing now).

> **STATUS: the swappable framework SHIPPED (2026-07-27).** `config/voice-providers.json`
> + `server/voice/voiceProviderService.js` + `/api/voice-providers/*`. A model is now a
> config entry, not code. **Piper** is installed and running as the local default on the
> laptop (verified speaking over WSLg). Everything below is the catalogue of what plugs into
> that registry — **model choice is now a data edit**, so "try a better one on the PC later"
> is `atlas`-style: add an entry, point it at the model, `POST /api/voice-providers/<kind>/active`.
> The heavy full-duplex models (PersonaPlex ~19 GB, Qwen 24 GB) are registered but light up
> only on the 5090 / when their server is running — they degrade cleanly here.

Model churn is fast (GPT-Live shipped July 8; new open models monthly), which is exactly why
the registry — not any single model — is the deliverable. The strongest *turnkey open* options
landed Jan–Mar 2026; the true SOTA (GPT-Live) is closed. Newer open frameworks (X-Talk) and
research (DyaPlex, ASPIRin, SoulX-Duplug, mid-2026) are noted below but not yet turnkey.

## Two architectures, pick per use

**A. Single full-duplex "speech model"** — listens and talks at the same time, real
barge-in, ~persona/voice control. No reasoning, no tools. This is the "feels like talking
to a person" layer.

**B. Pipeline (STT → LLM/agent → TTS)** — swappable parts, the LLM can be your existing
Claude/Codex agent, so it can actually *do things*. Higher latency than A, but this is how
JARVIS gets both a voice AND the whole orchestrator API. Matches the pluggable backends the
codebase already has (`speechService`, `whisperService`).

The right answer is **both**: A for ambient chat, B when the utterance needs to become work.

## Full catalogue of options (everything found — nothing wasted)

### Full-duplex speech-to-speech (single model, real barge-in)

| Model | Open? | Params | VRAM | Latency | License | Notes |
|---|---|---|---|---|---|---|
| **GPT-Live-1 / -mini** (OpenAI, Jul 8 2026) | ❌ closed | — | cloud | best-in-class | proprietary | The current SOTA; full-duplex, natural turn-taking, live translation. **API not out yet.** Reference target, not self-hostable. |
| **NVIDIA PersonaPlex** ⭐ (Jan 2026) | ✅ | 7B | ~19 GB BF16 / 8–16 GB quant | ~70 ms switch, ~170 ms resp | open weights | Best open local. Moshi + Mimi. Persona/voice control. Voice-only (no tools), 4-min context. `github.com/NVIDIA/personaplex`. |
| **Moshi** (Kyutai, 2024) | ✅ | 7B | ~16 GB | ~200 ms | open | The base PersonaPlex fine-tunes. `moshi.cpp` for quant/CPU. |
| **X-Talk** (mid-2026) | ✅ | cascaded | light | low, interruptible | open | Pure-Python full-duplex *framework* (STT+LLM+TTS with barge-in). Newer, lighter than PersonaPlex. Registered in the registry (`xtalk`). |
| DyaPlex / ASPIRin / SoulX-Duplug | ✅ papers | — | — | — | research | Mid-2026 arXiv; plug-and-play duplex state prediction. Not turnkey yet — watch these. |
| FlexDuo / SALM-Duplex | ✅ papers | — | — | — | research | Pluggable duplex modules; ideas to steal, not servers. |

### Omni (one model reasons + streams speech; not true barge-in)

| Model | Params | VRAM | License | Notes |
|---|---|---|---|---|
| **Qwen3.5-Omni-30B-A3B** (Mar 2026) | 30B MoE / 3B active | ~24 GB INT4 (fits 5090) | Apache 2.0 | Thinker+Talker = text **and** speech in one pass, no separate TTS. Reasons + tools. vLLM ≥ 0.17. Older now — expect newer omni models; swap when they land. |

### STT (listen) — pipeline lane

| Model | VRAM | Notes |
|---|---|---|
| **Parakeet TDT** ⭐ (NVIDIA) | small | RNN-T, streaming, RTFx > 2000 — lowest latency. Best on the 5090. Registry id `parakeet`. |
| **faster-whisper** (CTranslate2) | small | Fast Whisper reimpl, GPU/CPU. Drop-in. Registry id `faster-whisper`. |
| **whisper.cpp** | small | The existing path. Accurate, offline. Registry id `whisper-cpp`. |
| **Distil-Whisper / Moonshine** | tiny | Lightest; Moonshine for edge/CPU (laptop). Registry id `moonshine`. |

### TTS (speak) — pipeline lane

| Model | VRAM | License | Notes |
|---|---|---|---|
| **Kokoro-82M** ⭐ | tiny | Apache 2.0 | Best lightweight open TTS 2026. Natural, tiny compute. Registry id `kokoro`. |
| **Chatterbox** (Resemble) | small (GPU for RT) | permissive | Real-time + voice cloning. Registry id `chatterbox`. |
| **Piper** ✅ installed | tiny (CPU) | MIT | **Running now as the local default.** Fully offline, fast. Registry id `piper`. |
| **CosyVoice2-0.5B** | small | — | Ultra-low-latency streaming. |
| **Fish S2 Pro** | — | — | Sub-100 ms on vLLM, 3B Llama-style decoder. |
| **Orpheus / Higgs Audio V2 / Dia2 / XTTS-v2 / F5-TTS** | varies | varies | Strong alternatives; clone quality fools listeners 70–85% on a 4060 Ti 16 GB or 3060. |
| **espeak-ng** | none | GPL | Robotic last-resort, never fails. Registry id `espeak`. |

## Recommended models

### Full-duplex (architecture A)

| Model | Params | VRAM | Latency | License | Notes |
|---|---|---|---|---|---|
| **NVIDIA PersonaPlex** ⭐ | 7B | ~19 GB BF16 (RTX 3090); 8–16 GB quantized (moshi.cpp) | ~70 ms speaker-switch, ~170–257 ms response | Open weights (HF + `NVIDIA/personaplex`) | Built on Moshi + Mimi codec. Persona/voice control via prompt + sample. Local PyTorch web UI at `localhost:8998`, self-signed SSL for the mic. Limits: 4-min context window, repetition loops, **no tools/websearch/delegation**. |
| **Moshi** (Kyutai) | 7B | ~16 GB (moshi.cpp for less) | ~200 ms | Open | The foundation PersonaPlex fine-tunes. Use PersonaPlex unless you want the base. |

→ **On the 5090:** run PersonaPlex at full BF16 (~19 GB) — best latency, true full-duplex.
→ **On the 16 GB laptop:** PersonaPlex quantized via moshi.cpp fits and is testable now.

### Omni (architecture A½ — streaming speech out + reasoning, not true barge-in)

| Model | Params | VRAM | License | Notes |
|---|---|---|---|---|
| **Qwen3.5-Omni-30B-A3B** ⭐ | 30B MoE / 3B active | ~24 GB at INT4 (fits the 5090) | Apache 2.0 | Thinker (text) + Talker (streaming audio) = text **and** speech from one pass, no separate TTS. Real reasoning. vLLM ≥ 0.17. This is the one that can voice AND think/act. |

→ **On the 5090:** Qwen3.5-Omni at INT4 is the sweet spot if you want one model that reasons
and speaks. Won't fit the laptop comfortably.

### Pipeline parts (architecture B — the swappable lane)

- **STT (streaming):** **NVIDIA Parakeet TDT** (RNN-T, streaming, RTFx > 2000 — extremely
  low latency) is the pick; Distil-Whisper or Moonshine (edge) as lighter fallbacks. Both
  are tiny next to the LLM, so they run alongside anything on the 5090 and fine on the laptop.
- **TTS (streaming):** **Kokoro-82M** (Apache 2.0, tiny, fast — great default) or
  **Chatterbox** (Resemble, real-time, permissive, voice cloning). **CosyVoice2-0.5B** /
  **Fish S2 Pro** (sub-100 ms on vLLM) if you want the lowest latency. All run on the laptop.

## How to add / swap a model (the shipped workflow)

Adding "a better one on the PC later" is a **config edit + one API call**, no code:

1. Add an entry to `config/voice-providers.json` (or the per-machine override
   `~/.agent-workspace/voice-providers.json`): `{ id, kind: tts|stt|duplex, engine,
   requires: {command|env|server}, endpoint, quality, install, notes }`.
2. Install the model per its `install` hint.
3. Make it active: `POST /api/voice-providers/<kind>/active {"id":"<id>"}` — or set
   `activeTts/activeStt/activeDuplex` to `auto` and it wins automatically if it's the
   highest-quality one that passes its health check.
4. `GET /api/voice-providers` shows every provider with a live availability check, so you
   can see what's installed vs what needs setup.

On the **5090**: register PersonaPlex (`duplex`) pointing at its `localhost:8998` server and
`POST .../duplex/active {"id":"personaplex"}`; add `kokoro`/`parakeet` for the pipeline lane.
A provider whose model isn't present just shows `available:false` with its install hint — it
never breaks anything.

## How this plugs into JARVIS (the seams it extends)

The codebase was already 80% there — this extended the seams rather than bolting on:

1. **`speechService` already has pluggable TTS backends** (browser/piper/say/SAPI/espeak).
   Add `kokoro` and `chatterbox` as two more backends behind the same interface. Swap with
   the existing `POST /api/speech/backend`.
2. **`whisperService` already abstracts STT.** Add a `parakeet` backend next to whisper.cpp
   /openai-whisper. Same pattern.
3. **Full-duplex is a *realtime provider*, not a backend.** The PR already speaks a realtime
   protocol (`thread/realtime/*`, currently Codex app-server). Model it as a **voice-provider
   registry** exactly like the existing agent-provider registry: each provider declares
   `{ stt, tts, duplex }` capability and a transport. `CODEX_APP_SERVER`-style env/flags pick
   the active one:
   - `codex` — remote Codex realtime (what ships today)
   - `personaplex` — local full-duplex server at `localhost:8998`
   - `pipeline` — parakeet + <your agent> + kokoro
   The `getSignalForSession`-returns-null degradation pattern already in the supervisor is the
   same idea: "use the best available, fall back cleanly."
4. **Config-driven, hot-swappable:** one `config/voice-providers.json` (like
   `config/custom-agents.example.json`) so adding a model is data, not code — which is the
   "swap out voice models as needed" requirement, met the same way the agent registry meets it.

## Suggested first step (cheap, high-signal)

Wire the **pipeline** lane first (Parakeet STT backend + Kokoro TTS backend into the existing
services): it's the least risky, runs on the laptop today, makes the whole thing local, and
proves the swappable-provider registry. Then add **PersonaPlex** as a `duplex` provider for
the 5090 once the registry exists. Qwen3.5-Omni is the stretch goal for a single
voice-and-reason model.

## Sources
- **GPT-Live (OpenAI, Jul 8 2026, closed SOTA reference):** https://openai.com/index/introducing-gpt-live/ · https://techcrunch.com/2026/07/08/openai-releases-new-voice-models-for-more-natural-live-conversations/
- https://research.nvidia.com/labs/adlr/personaplex · https://github.com/NVIDIA/personaplex
- https://www.makeuseof.com/nvidia-personaplex-local-speech-model-8gb-vram/
- https://www.kunalganglani.com/blog/nvidia-personaplex-full-duplex-voice-ai
- https://github.com/QwenLM/Qwen3-Omni · https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct
- https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks (Parakeet/STT)
- https://localaimaster.com/blog/best-local-tts-models · https://bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models (Kokoro/Chatterbox/TTS)
- https://arxiv.org/pdf/2505.15670 (SALM-Duplex) · https://arxiv.org/pdf/2502.13472 (FlexDuo) · https://arxiv.org/pdf/2603.14877 (SoulX-Duplug)
