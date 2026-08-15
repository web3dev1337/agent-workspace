# Voice tier ladder
Req: implement PLANS/2026-08-15/VOICE_TIERED_ARCHITECTURE.md P1-P5 (work5 repo PR #1041).
Done: registry+tier2(Bonsai grammar+guards)+query fetchers+confirm-first+realtime manager+review chains. Live-tested all lanes on sandbox :5886.
Gotchas: legacy ollama matcher deferred when tier2 present; tier-1 pr patterns anchored; entities registry-grounded only; confirmations intercept before matching.
