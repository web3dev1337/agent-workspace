# Local real-time voice models — research + integration plan (2026-07-27)

Goal: full-duplex, back-and-forth, **local** voice for JARVIS, with models swappable at
runtime. Target hardware: **RTX 5090, 32 GB** (the real deployment) and an **RTX 3080
Laptop, 16 GB** (for testing now).

The strongest turnkey options actually landed Jan–Mar 2026, not June/July — the mid-2026
items (DyaPlex, ASPIRin, SoulX-Duplug) are research papers, not shippable servers yet. So
the recommendation below is built on what you can run this week.

## Two architectures, pick per use

**A. Single full-duplex "speech model"** — listens and talks at the same time, real
barge-in, ~persona/voice control. No reasoning, no tools. This is the "feels like talking
to a person" layer.

**B. Pipeline (STT → LLM/agent → TTS)** — swappable parts, the LLM can be your existing
Claude/Codex agent, so it can actually *do things*. Higher latency than A, but this is how
JARVIS gets both a voice AND the whole orchestrator API. Matches the pluggable backends the
codebase already has (`speechService`, `whisperService`).

The right answer is **both**: A for ambient chat, B when the utterance needs to become work.

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

## How this plugs into JARVIS (the swappable design you asked for)

The codebase is already 80% there — don't bolt on, extend the seams that exist:

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
- https://research.nvidia.com/labs/adlr/personaplex · https://github.com/NVIDIA/personaplex
- https://www.makeuseof.com/nvidia-personaplex-local-speech-model-8gb-vram/
- https://www.kunalganglani.com/blog/nvidia-personaplex-full-duplex-voice-ai
- https://github.com/QwenLM/Qwen3-Omni · https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct
- https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks (Parakeet/STT)
- https://localaimaster.com/blog/best-local-tts-models · https://bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models (Kokoro/Chatterbox/TTS)
- https://arxiv.org/pdf/2505.15670 (SALM-Duplex) · https://arxiv.org/pdf/2502.13472 (FlexDuo) · https://arxiv.org/pdf/2603.14877 (SoulX-Duplug)
