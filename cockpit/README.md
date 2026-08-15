# Cockpit

White-theme operations terminal for the Zero-Human Company hackathon. Seven modes,
keys `1–7`. All seven modes are live.

Cockpit is the frontend. The backend is a separate process in `../backend`.

```bash
# terminal 1 — API (Terac hires, secrets)
cd ../backend && npm install && npm run dev

# terminal 2 — this UI
npm install
npm run dev
```

## Modes

1. **Overview** — org chart of the company's agents (CEO center, departments in
   quadrants). Node rings show state: idle 40%, thinking = clock-hand arc sweep,
   acting = full ring + chip. A single accent particle travels an edge when data
   flows — the only motion on screen. Bottom third: activity feed with evidence
   chips. Floating MRR ticker + full-cycle loop counter.
2. **Audience Map** — top-left switch: **Mock swarm** (1,005 seeded nodes) or
   **@tryterac** (live X audience via the backend). Click a node to pin the
   username. A **Product queue** strip lists committed features GitHub sent
   over for posting; Start drafts five writer posts for the selected item.
   Terac hires a cluster-matched expert via `POST /api/terac/hires`;
   Publisher posts (mock X).
3. **Product** — GitHub observer for **AgentBasis/agentbasis-python-sdk**
   only (no ship, no repo picker). Three columns: committed features
   (merged PRs + Add/Enhance commits), pull requests, and the commit log.
   Those features queue to Audience for posting. Customer bugs from
   Support (Linq) land in the Bug reports strip and get checked against
   this SDK.
4. **Finance** — actual revenue line joining live MRR at the NOW hairline,
   P10–P90 forecast fan, campaign markers with cause→effect underlines,
   five-model forecaster ensemble (bull / bear / churn-hawk / base-rate /
   momentum) with a disagreement gauge, the confidence-weighted aggregation
   receipt, and a generated forecast report with per-rail totals.

   **Real rails**: Stripe (test sandbox) and Whop read through the backend —
   read-only, recent payments + totals, with live/sim badges on the rail
   chips. The backend refuses any Stripe key that isn't `sk_test_`. Arm with:

   ```
   STRIPE_SECRET_KEY=sk_test_...
   WHOP_API_KEY=...
   ```

   **Bob the Banker**: the operating account ($300k–$500k, random each boot)
   managed end-to-end by the CFO Agent — balance, stacked allocation bar,
   and the full percentage split (Payroll & Ops / Taxes reserve / Marketing /
   Investment / Infra & compute / R&D / Cash buffer). The CFO rebalances on
   its own clock with a stated reason, logged to the feed.
5. **Ledger** — deliberately the plainest mode: dense money ledger with running
   balance and an honest TEST MODE chip, per-call LLM spend ledger with the
   kicker ("This company cost $0.36 to operate today") and a spend-by-department
   donut, and the post strip with predicted-vs-actual engagement bars — hits get
   a green check, misses get an honest gray dash.
6. **Competition** — three intel agents (Changelog Scout, Gap Analyst, Brief
   Writer) watch rivals and forward gaps to product. Product then **ships
   for real** on `AgentBasis/agentbasis-python-sdk`: Repo Agent opens a
   `zeroco/` branch, writes a python module under `agentbasis/`, squash-merges,
   and queues marketing. First ship ~10s after boot, then every ~3 minutes
   (cap 6/session). Terac is **not** used (`backend/Agent.md`). Requires
   `GITHUB_TOKEN` with push on that repo. Without a token the write fails
   honestly — no fake merge.
7. **Investment** — the market desk. Five live crypto charts (BTC · ETH ·
   SOL · DOGE · AVAX) tick on a simulated Alpaca paper-trading feed. Five
   desk agents (Prudence, Momentum, Quant, Runway Guardian, Yield Scout)
   each predict 30d ROI per asset, one at a time; the consensus ranking
   picks a winner and the desk deploys treasury (Growth → Crypto) into the
   highest-ranked asset via a paper order. Positions mark to market live,
   with unrealized P&L shown honestly — losers in red.

   **Alpaca is live**: charts use real crypto prices from data.alpaca.markets
   (no keys needed) via the Vite dev proxy. To arm real *paper orders*, add
   to `../.env` (keys stay server-side, injected by the proxy):

   ```
   ALPACA_API_KEY=your_key_id
   ALPACA_SECRET_KEY=your_secret
   ```

   Without keys the desk records honest sim fills; the treasury chip always
   states the current mode (live · paper orders / live data · sim fills /
   sim fallback). If the feed is unreachable, prices fall back to the
   simulated walk so the demo never stalls.

   **Terac confidence gate**: before each deploy, Terac Liaison hires a real
   crypto expert (via `../backend`, same as the audience gate) who states
   confidence in the trade — the number rides on the fill and shows in the
   gate strip with a bar, notes, and the dashboard link. Real hires cost
   ~$12/study, so they're throttled to one per 10 minutes; in between (or if
   Terac is unfunded/off/slow) the gate falls back to desk-consensus
   confidence — how many of the five agents independently ranked the winner
   first — and says so honestly. Requires Terac org balance ≥ $12 per hire.

8. **Support** — customer service over [Linq](https://linqapp.com) messaging
   (iMessage/RCS/SMS). Three agents run the desk: Triage classifies topic and
   priority, Writer drafts, QA approves, then the reply delivers. Inbox +
   conversation threads with per-message agent and delivery attribution,
   live stats (median first response, CSAT — middling ratings shown
   honestly), and churn-risk tickets escalated to a human queue instead of
   auto-replied. To arm real sends, add to the workspace `.env`:

   ```
   LINQ_INTEGRATION_TOKEN=...
   LINQ_SEND_FROM=+1XXXXXXXXXX     # your Linq org number
   LINQ_TEST_PHONE=+1XXXXXXXXXX    # the ONLY number the demo will ever text
   STRIPE_PAYMENT_LINK=https://buy.stripe.com/...   # subscribe link the agent texts
   ```

   Sends go only to the test phone, at most one real send per session; onboard
   uses that shot to deliver the Stripe subscribe link. LINQ LIVE / SUBSCRIBE
   LINK chips state the mode.

## Architecture

- `src/sim/engine.ts` — the simulated company: a jittered scripted loop
  (repo scan → merge detected → CEO arms a campaign → payments → forecast →
  loop closes). Audience posting is Start-driven: 5 writers queue posts →
  9 jurors vote → Terac expert reviews → mock post.
- `src/sim/terac.ts` — thin client for `../backend` (`/api/terac`).
- `src/data/audience.ts` — seeded follower population + force layout, identical
  on every load so the demo is stable on stage.
- `src/modes/` — one file per mode. Design tokens live in `src/styles.css`.

Swap the engine's scripted events for real backend events (WebSocket/SSE) by
replacing calls to `log/fire/setNode` — the UI doesn't care where events come from.
