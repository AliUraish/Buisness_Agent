# TODOS

## Integration

### Swap simulated engine for real backend events
**Priority:** P2
Replace the scripted loop in `src/sim/engine.ts` with a WebSocket/SSE client
fed by the real orchestrator. The UI only consumes `log/fire/setNode`-shaped
events, so this is a transport swap, not a rewrite.

## Completed

### Split Terac into backend
Cockpit calls `/api/terac`. `backend/` owns the Terac REST hire and the key.
**Completed:** v0.6.0.0 (2026-08-15)

### Real Terac hire on Audience Start
Vite proxy `/terac` + `TERAC_API_KEY`. After the jury, create/launch a 1-person
claim-review opportunity and poll submissions. Missing key still completes the
demo (TERAC OFF). Live waits on the expert.
**Completed:** v0.5.0.0 (2026-08-15)

### Audience Start + Terac claim gate
Start queues 5 writer posts (mock data). Jury votes. Terac hires a verified
expert to approve/revise before a mock post to X.
**Completed:** v0.4.0.0 (2026-08-15)

### Audience campaign sim (5 writers / 9 jurors)
X-follower clustering by one agent, five writer drafts, nine juror votes,
click-to-pin usernames on the map. No human in the loop.
**Completed:** v0.3.0.0 (2026-08-15)

### Build Mode 5 — Ledger ("The Receipts")
Money ledger with running balance + TEST MODE chip, LLM spend ledger with the
operate-today kicker and department donut, post strip with predicted-vs-actual
engagement bars.
**Completed:** v0.1.1.0 (2026-08-14)
