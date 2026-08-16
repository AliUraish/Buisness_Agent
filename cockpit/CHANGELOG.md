# Changelog

All notable changes to Cockpit are documented here.

## [0.28.0.0] - 2026-08-15

### Changed
- All human gates now use the LOCAL review form at `/review` instead of Terac
  (Terac auth is broken): treasury division, legal-finance button, trade
  confidence, marketing claim check, and PR ship verification. The form
  submits for real — pending review hydrates on load, verdict posts back,
  and the waiting gate picks it up within 5s.
- Trading bankroll capped at a real **$20** (open positions at cost), not the
  $100k Alpaca paper balance. Fills are $3–6 each; deploys skip once the cap
  is reached.

## [0.27.0.0] - 2026-08-15

### Added
- Agents run on a mock credit pool. **Credit Buyer** purchases a $9 pack
  from treasury when ≤8 credits remain (also recharges the backend call cap).

## [0.26.2.0] - 2026-08-15

### Changed
- Paper fills wait on the Terac form. The desk polls until a human
  submits; High/Medium then executes, Low holds.

## [0.26.1.0] - 2026-08-15

### Changed
- Desk trades by itself every ~45s. Open P&L marks into Finance revenue
  immediately; closes after +0.3% or 90s.

## [0.26.0.0] - 2026-08-15

### Added
- Market desk paper-trades on Alpaca without waiting for LLM keys. After a
  fill it sells when the mark is +1.2% or 8 minutes old, books realized
  P&L into company revenue (Stripe + desk), and shows paper equity.

## [0.25.0.0] - 2026-08-15

### Added
- Product agents open PRs on AliUraish/Buisness_Agent. Banner shows
  **CAN OPEN PRS** vs **READ ONLY**, plus **Open PR**. Each ship/PR
  shows **Terac verified**, **Terac reviewing**, or **Terac not verified**.
  Hire fail or reject leaves the PR open (not merged).

## [0.24.0.0] - 2026-08-15

### Changed
- Terac is no longer the Audience post gate. Finance has **Terac · legal
  finances** — hires a human; page is `/legal` (replace that HTML).

## [0.23.0.0] - 2026-08-15

### Changed
- Product is **Bob the Busines** on
  [AliUraish/Buisness_Agent](https://github.com/AliUraish/Buisness_Agent).
  Every agent works that repo. Repo Agent opens PRs under `product/`;
  Terac humans review, then merge.

## [0.22.0.0] - 2026-08-15

### Removed
- AgentBasis product targeting: subscribe pages (`/subscribe`,
  `site/subscribe.html`), agentbasis.co copy in Terac/Linq, and the
  hardcoded `AgentBasis/agentbasis-python-sdk` GitHub pin + ship catalog.
  Product now follows `GITHUB_REPO`. Agents ship under `product/` once
  that repo is set.

## [0.21.0.0] - 2026-08-15

### Changed
- Terac `/review` is a ship form: feature / PR, **Should we ship this?**,
  then **is the code ready?** plus Open PR + Open repo
  (`AgentBasis/agentbasis-python-sdk`). Screeners match that form.

## [0.20.0.0] - 2026-08-15

### Added
- Subscriber site at `/subscribe` (also backend `/`): AgentBasis product,
  link to agentbasis.co, Stripe checkout CTA from `STRIPE_PAYMENT_LINK`
- Terac human page at `/review`: product brief, **Open agentbasis.co**,
  then three questions (opened it? would you pay $9? why)

## [0.19.0.0] - 2026-08-15

### Added
- Perflo (perflo.ai — the agent bank) replaces Bob the Banker. Backend
  `GET /api/perflo/summary` reads real balance + activity from
  api-gateway.perflo.ai (Bearer PERFLO_TOKEN, read-only). Live: the bank
  panel shows the real balance with a PERFLO LIVE chip and the spend limit
  becomes the real available balance; without a token it says
  PERFLO OFF · SIM honestly
- Funding pools with overflow: every real cost (LLM calls, hires) draws
  from Perflo first; when the limit fills, the source flips to Stripe with
  a feed event ("Perflo spend limit reached — costs now drawing from
  Stripe") and the meter shows both pools
- The CFO division + Terac review now operate on the Perflo account;
  restored Neon snapshots migrate to the new bank shape

### Removed
- Whop from the Finance page — Stripe is the only revenue rail shown

## [0.19.0.0] - 2026-08-15

### Changed
- Terac hires are REST-only (no MCP): 1 person, b2c general population,
  5-minute **activity** (not an AI interview). Task URL is the subscribe
  review page (`GET /review`, or `REVIEW_URL` if public). Screeners no
  longer reject non-experts — cheaper pool, faster fill.

### Added
- Participant page at `/review` — the exact UI the Terac person opens.

## [0.18.0.0] - 2026-08-15

### Added
- The money division is a real decision: at boot the CFO Agent
  (claude-sonnet-5) divides the ENTIRE Bob the Banker balance across
  sensible categories with reasoning (JSON-validated, forced to sum 100,
  applied once per company-lifetime via a persisted `divided` flag), then
  a Terac human reviews the division using the session's single hire —
  backend `POST /api/terac/allocations` with a full review doc (account,
  proposed split with dollars, CFO reasoning, Approve/Adjust checks)
- Bank panel review strip: CFO dividing… → human reviewing → HUMAN ✓
  approved / ⚑ adjust / skipped-with-reason. Free failures (Terac 401/412)
  refund the hire slot

### Changed
- Finance page restored to its original layout in live-only mode: forecast
  chart with fan, five-model ensemble, aggregation receipt, and report are
  back — anchored at the model MRR so a $0 real-revenue day can't produce
  $0/NaN forecasts. Revenue-today hero stays real above it

## [0.18.0.0] - 2026-08-15

### Added
- Linq onboard: Support texts the Stripe subscribe link to the test phone
  (`POST /api/linq/onboard`). Arm with `STRIPE_PAYMENT_LINK=https://buy.stripe.com/…`
  (or a Checkout URL). One real send per session — this onboard is that send.
  Support mode: SUBSCRIBE LINK chip + "Text subscribe link". Failed sends stay
  honest in the thread. Website sells the sub; cockpit only delivers the link
  and reads the money on Stripe.

## [0.17.0.0] - 2026-08-15

### Changed
- Terac efficiency: ONE human hire per session across ALL gates (audience
  post gate, trade confidence gate) via a shared budget counter — attempts
  count too, so a failed hire can never trigger a second paid call. When
  the budget is spent, every gate falls back honestly and says so
- Cheapest legal study: task duration 15 → 7 minutes on all three
  opportunity kinds (Terac refuses budgets under $5)
- The ship-review opportunity is now a full reviewer interface: one doc
  with sections — RESEARCH (intel findings + rival), FEATURE IDEA,
  IMPLEMENTATION with the public PR link (github.com/…/pull/N) — plus
  per-item screening checks (research sound? feature worth shipping?
  PR implements it?) before the final Approve/Reject verdict

## [0.16.1.0] - 2026-08-15

### Fixed
- Linq integration rebuilt for Partner API v3 (the token's actual API):
  Bearer auth, `/api/partner/v3/chats`, from/to/message.parts body. The
  org's sending number is auto-discovered from `/v3/phone_numbers` and
  cached, so LINQ_SEND_FROM can be anything; phone inputs normalize to
  E.164 (unit-tested). Error extraction now surfaces Linq's real codes
- Verified end-to-end: sandbox requires the recipient to text the org
  number first (error 2008); after the handshake, a real SMS delivered
  (chat + message ids returned)

## [0.16.0.0] - 2026-08-15

### Added
- Neon Postgres is the company's persistent memory. Backend owns NEON_URL
  (`/api/db/*`): an append-only `events` journal and a `state` key/value
  snapshot store, schema auto-created on first touch
- Engine hydrates from Neon before any loop starts: feed history, LLM
  ledger + spend, positions, executed market rounds, bank, tickets, posts,
  bug checks, capabilities, and counters all survive page reloads. Every
  feed event journals fire-and-forget; domain snapshots persist every 30s
- In-flight records are restored honestly (mid-pipeline tickets reset to
  open, unfinished bug checks close as not-reproduced with a note); id
  sequences skip past restored records. No NEON_URL → in-memory as before
- Verified live: a reload restored the prior session's journal, 12-row
  LLM ledger, and both real Alpaca positions

## [0.15.1.0] - 2026-08-15

### Added
- Alpaca paper orders armed and verified: the desk's first real order
  (ETH/USD $600 notional market buy) filled on the paper account and
  matches Alpaca's own records — order id, fill price, and quantity.
  Natural spend cap: deploys stop when the Growth allocation runs out

## [0.15.0.0] - 2026-08-15

### Added
- The agents are real LLMs. Backend LLM proxy (`POST /api/llm/complete`,
  `GET /api/llm/status`) calls Anthropic (claude-haiku-4-5 / sonnet-5),
  OpenAI (gpt-5-mini, minimal reasoning effort), and Gemini (2.5-flash,
  thinking budget 0) with keys server-side. Spend rails: 350 output tokens
  per call, 250 calls per session, estimated cost tracked per call
- Real reasoning wired in: the five desk personas predict 30d ROI from
  live Alpaca data (persona → provider split, JSON-validated, scripted
  fallback per agent); the CFO rebalances Bob the Banker with a real
  decision over real numbers (may choose to hold); the five writers draft
  real posts across three providers; the nine jurors vote for real as
  follower personas. All under LIVE_ONLY — real calls, real cadences
  (desk + CFO every 5 minutes)
- The Mode 5 LLM ledger is now genuine: actual provider, model, token
  counts, and estimated cost per call — verified rows from gpt-5-mini,
  gemini-2.5-flash, and claude-haiku-4-5
- Env conveniences: LINQ_API_KEY accepted as the Linq token alias; the
  Vite Alpaca proxy also reads backend/.env

### Fixed
- gpt-5-family and Gemini 2.5 burned tiny token budgets on reasoning and
  returned empty text — now minimal reasoning / zero thinking budget

## [0.14.0.0] - 2026-08-15

### Changed
- LIVE-ONLY mode (`LIVE_ONLY = true` in `src/sim/engine.ts`): all mock data
  and fabricating loops are off until the LLM API keys land. What still
  runs is exactly what's real — Stripe revenue polling, GitHub scan + SDK
  ship loop, Alpaca price feed, Terac, Linq status, X audience — plus the
  audience follower swarm (kept per request) and Bob the Banker (explicit
  feature, labeled SIM BANK, CFO rebalance loop paused)
- Gone until keys land: seeded transactions / LLM rows / posts / tickets /
  bug checks / market rounds / positions / intel moves / committee history /
  sim feature board; ambient payments; ops, competition-intel, investment-
  desk, support-inbound, and CFO loops; fake forecaster runs; the
  fabricated 30-day revenue chart; sim LLM billing (`llm()` is a no-op)
- Top-bar MRR now tracks real Stripe revenue today (boots $0); LLM spend
  boots $0.00; loop counter 0; capability matrix "ours" cells start empty
  and flip only when the real GitHub ship loop lands a feature
- Honest empty states: Investment desk "paused — awaiting LLM API keys",
  empty positions/inbox/ledgers; sim seed generators remain exported and
  unit-tested for when the full simulation is re-enabled (flip the flag)

## [0.13.0.0] - 2026-08-15

### Added
- Ongoing product ship loop on **AgentBasis/agentbasis-python-sdk**: Changelog
  Scout / Gap Analyst / Brief Writer research a gap, then Repo Agent opens a
  branch, writes a python module under `agentbasis/`, squash-merges the PR,
  and queues the feature for marketing. First ship ~10s after boot, then
  every ~3 minutes, cap 6 per session. No Terac
- Backend `POST /api/github/ship` creates the branch + file + PR + merge
  with the GitHub token. Failed writes stay failed — no fake merge
- Product banner and Competition pipeline show live GitHub shipping instead
  of "observing / not shipping"

### Changed
- Competition intel still reports rival gaps but no longer opens fake
  `src/auth/sso.ts` PRs. SDK files only

## [0.12.1.0] - 2026-08-15

### Changed
- Money ledger runs on real Stripe when connected: merged Stripe/Whop
  recent payments (newest first) with a running day total, STRIPE
  LIVE/TEST chip, an honest empty state before the first charge, and a
  footer with revenue today · payments · net. Sim rows only when Stripe
  is off (now labeled "SIM · TEST MODE")
- Rails re-poll tightened to 60s while live so new charges land in the
  ledger within a minute
- RailLive now carries the recent-payments list from the backend

## [0.12.0.0] - 2026-08-15

### Added
- "Revenue today" hero on Finance — the hackathon prize metric. The backend
  sums Stripe balance transactions since local midnight
  (`GET /api/pay/today`: gross, net, fees, refunds, payment count) and the
  engine polls it every 60s. STRIPE LIVE / TEST / OFF chip always states
  the mode; a new payment landing between polls fires a green +$Δ feed
  event and an org-chart particle
- Live-mode Stripe keys are now accepted for READS ONLY (the backend still
  has zero Stripe write endpoints — no charges, refunds, or payouts can be
  created). Restricted read-only keys (rk_live_) recommended
- When real Stripe is connected, simulated payments stop entirely — the
  prize number can never be inflated by fake revenue
- Backend `sumBalanceTx` revenue math with four unit tests (fees, refunds,
  unrelated transaction types, empty day)

## [0.11.0.0] - 2026-08-15

### Added
- Competition ship pipeline: Changelog Scout, Gap Analyst, and Brief Writer
  research a rival gap, then Repo Agent opens a PR. Terac's single job is
  to verify research → PR (Approve / Reject). That hire is not armed —
  `SHIP_TERAC_ARMED = false` — so the pipeline stops at a ready PR
- Backend `POST /api/terac/ships`: one opportunity that shows the brief
  and the PR together. Product strip "From competition" shows the agent PR
- Tests: empty boot pipeline, researcher billing, Terac not armed,
  parseShipVerdict, shipOpportunityBody carries research + PR number

## [0.10.0.0] - 2026-08-15

### Added
- Finance goes real: Stripe (TEST MODE ONLY — the backend refuses any key
  that isn't sk_test_) and Whop read through the backend
  (`GET /api/pay/summary`, read-only: recent successful payments + counts,
  never creates charges). Rail chips in the forecast report show live
  totals with a "test · live" badge, or sim totals honestly labeled
- "Bob the Banker": the company's operating account, seeded with a random
  $300k–$500k each boot, fully managed by the new CFO Agent. The Finance
  panel shows the balance, a stacked allocation bar, and every category
  with percent + dollars: Payroll & Ops, Taxes reserve, Marketing,
  Investment, Infra & compute, R&D, Cash buffer (always exactly 100%)
- CFO Agent rebalances on its own clock with a stated reason ("Q3
  estimated taxes accrue next month — Cash buffer → Taxes reserve 2pt"),
  logged to the feed and billed to finance in the LLM ledger
- Five new tests: balance range, percentages-sum-to-100, business
  coverage (taxes/marketing/investment/payroll), Dodo removal, CFO billing

### Removed
- Dodo payment rail — Stripe and Whop only, in seeds, live payments, and
  the money ledger

## [0.9.1.0] - 2026-08-15

### Changed
- GitHub Product is pinned to **AgentBasis/agentbasis-python-sdk** only —
  no repo picker, no auto-pick of other accounts. Scan extracts merged
  PRs plus Add/Enhance commits (this repo is not conventional-commit)
- Support complaints and bug checks are about this SDK (Anthropic stream
  spans, Gemini tool_use names, OpenTelemetry wrap) so the loop is
  Product scan → Audience post → Support complaint → Product bug check
  on one project



### Added
- Bug pipeline, support → product: when a customer reports a bug over Linq,
  Support Triage routes it to Product and a randomly deployed engineer
  agent from the Anthropic / Google / OpenAI pool (Claude Engineer ·
  claude-sonnet-5, Gemini Engineer · gemini-3-pro, GPT Engineer · gpt-5)
  checks it: deploying → reproducing → checking code → verdict
- Product mode "Bug reports" strip: agent + provider + model on each card,
  CONFIRMED verdicts carry file:line + commit receipts (violet left
  border), NOT REPRODUCED misses shown honestly with a repro-steps request
- Engineer LLM calls bill to product in the ledger under the deployed
  model's real provider; feed logs the deployment and the verdict
- Five new tests: provider pool coverage, pool membership, receipt
  presence on confirmed verdicts, honest-miss seeding, department billing
- Simulated today — the real-model seam is `runBugCheck()`/`ENGINEERS` in
  `src/sim/engine.ts`: swap the scripted steps for real Anthropic / Gemini /
  OpenAI calls and everything downstream just reads the BugCheck record

### Changed
- Agent count 38 → 41 (three engineer agents); second bug scenario added
  to the support issue pool (CSV export timeout)

## [0.9.0.0] - 2026-08-15

### Added
- Product talks to GitHub through the backend (`GET /api/github/scan`).
  Repo Agent lists commits and PRs on the authenticated user's repo
  (override with `GITHUB_REPO=owner/name`); Manifest Builder extracts
  committed features from `feat:` / `feat(scope):` commits and merged
  PRs and sends them to marketing. Product does **not** ship
- Product board when live: Committed features / Pull requests / Commits,
  with a repo picker and GITHUB LIVE chip. Health strip uses real
  commit-per-day buckets and open PR count
- Audience Product queue: every unposted committed feature sits in a
  strip above the writer bench. Click to pick; Start drafts the 5-writer
  campaign for that feature

### Changed
- Fake product ship loop pauses while GitHub is live so the board is
  observation-only



### Added
- Audience Map source switch (top left): Mock swarm vs @tryterac. Live side
  loads through the backend (`GET /api/x/audience`) using `X_BEARER_TOKEN` —
  follower list when the X tier allows it, otherwise recent mention authors.
  Same cluster colors, click-to-pin handles. No HTML scrape.

## [0.7.0.0] - 2026-08-15

### Added
- Mode 8 Support: customer service over Linq messaging (iMessage/RCS/SMS).
  Inbound customer texts flow through a three-agent pipeline — Support
  Triage classifies topic + priority, Support Writer drafts, Support QA
  approves — then the reply delivers. Inbox table with click-to-open
  conversation threads (customer left, ZeroCo right with agent + delivery
  attribution), live stats strip (open, resolved today, median first
  response, CSAT, human queue), and the agent bench
- Churn-risk tickets are never auto-answered — escalated to the human
  queue with a rose chip, visible in the thread
- Real Linq integration via the backend: `POST /api/linq/send` creates a
  chat + message through `api.linqapp.com/api/partner/v2/chats`, token
  server-side. Live only when LINQ_INTEGRATION_TOKEN + LINQ_SEND_FROM +
  LINQ_TEST_PHONE are all set; sends go ONLY to the test phone, and the
  engine limits itself to one real send per session. LINQ LIVE/OFF chip
  states the mode honestly; everything else is sim-delivered and labeled
- Six new tests: CSAT presence and honesty, churn-risk no-auto-reply,
  masked phones, conversation ordering, department billing

### Changed
- Agent count 35 → 38 (three support agents); support LLM calls bill to
  the ledger like every other department

## [0.6.1.0] - 2026-08-15

### Added
- Terac confidence gate on the market desk: before deploying, Terac Liaison
  hires a real crypto expert (backend `POST /api/terac/trades`) who states
  confidence in the trade via High/Medium/Low/Very-low buckets (midpoints
  88/62/38/12). The confidence rides on the fill — feed line, gate strip
  with confidence bar, expert id, notes, quote, and dashboard link
- Honest fallback chain: no key / API error / expert slower than ~30s →
  deploy proceeds on desk-consensus confidence (how many of the 5 agents
  ranked the winner first), the note says exactly why, and a background
  poller upgrades the gate when the expert's answer lands after the fill
- Hire cooldown: real Terac hires cost ~$12/study and rounds run every
  minute, so the desk hires at most once per 10 minutes — desk consensus
  covers the rounds in between
- Backend: `hireTradeReview` / `pollTradeReview` + `/api/terac/trades`
  routes, `parseConfidence` with tests

### Fixed
- Terac launch calls sent an empty body with a JSON content-type — the API
  rejected every launch with "Failed to parse request body". Both the claim
  review and trade review launches now send `{}` (this unblocked the real
  audience hires too)
- Task duration raised 5 → 15 minutes: Terac rejects studies budgeted under
  $5, and the 5-minute task priced at $4

## [0.6.0.0] - 2026-08-15

### Changed
- Terac hire moved out of Cockpit into a separate `backend/` process. The UI
  only calls `/api/terac/*`; Vite proxies that to `http://127.0.0.1:8787`.
  `TERAC_API_KEY` is read only by the backend. Audience Start behavior is
  unchanged (create + launch + poll, still publish if the key is missing)

## [0.5.0.0] - 2026-08-15

### Added
- Real Terac hire on the Audience Start loop: after the jury picks a winner,
  Terac Liaison creates a 1-person b2b claim-review opportunity (Approve /
  Revise screener) through `https://terac.com/api/external/v2`, launches it,
  and polls submissions. A revise verdict rewrites the post before publish
- Vite proxy `/terac` injects `TERAC_API_KEY` from `../.env` server-side.
  Audience panel chips: TERAC LIVE vs TERAC OFF. Dashboard link on the job
- If no expert answers within ~30s, the gate stays waiting and a background
  poller posts when the submission lands. Missing key or API error is shown
  honestly; the queue demo still completes so Start is never a dead end

## [0.4.1.0] - 2026-08-15

### Added
- Real Alpaca API on the market desk: live crypto prices (latest trades,
  polled every 2.5s) and real 5-minute bar history for BTC · ETH · SOL ·
  DOGE · AVAX from data.alpaca.markets — no keys needed for market data
- Vite dev proxy (`/alpaca/data`, `/alpaca/paper`) that injects
  `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` from `../.env` server-side, so
  keys never enter the browser bundle. With keys present, desk deployments
  submit real paper orders (market BUY by notional); without keys, fills
  are simulated and the chip says so
- Feed status chip on the treasury: "Alpaca · live · paper orders" /
  "live data · sim fills" / "sim fallback" — always honest about which
  mode is running
- Graceful degradation: sim prices cover the connect window, three failed
  polls fall back to sim with a feed log, rejected orders record a sim fill

### Changed
- Seeded demo positions re-anchor to live prices on connect (one winner,
  one honest loser) so P&L reads sane against real market levels

## [0.3.1.0] - 2026-08-15

### Changed
- Mode 7 Investment reworked into the market desk: five live crypto charts
  (BTC · ETH · SOL · DOGE · AVAX) on a simulated Alpaca paper-trading feed,
  five desk agents predicting per-asset 30d ROI one at a time, consensus
  ranking strip, and automatic deployment into the highest-ranked asset
  (Growth allocation → Crypto, treasury still sums exactly to cash)
- Positions table with live mark-to-market and unrealized P&L — losers shown
  in red, honestly
- The winning asset's chart card gets a "#1 pick" marker; fills log an
  order id into the activity feed
- Five new tests: asset list, price-history sanity, crypto-allocation-equals-
  positions-at-cost, qty/entry/cost reconciliation, consensus-winner integrity
- The proposal/voting committee flow is retired from the UI (types and seeds
  remain); the same five personas now run the desk. Swapping the simulated
  feed for the real Alpaca API is contained to the price interval + the
  execution block in `marketRound()`.
Format: [MAJOR.MINOR.PATCH.MICRO] - YYYY-MM-DD

## [0.4.0.0] - 2026-08-15

### Added
- Audience **Start** button: five writer agents queue five posts for @zeroco
  on press (mock copy, real queue). Nine jurors vote, then Terac Liaison
  hires a cluster-matched expert ($40 mock MCP fill) to approve or revise
  the winner before Publisher posts
- MOCK chip on the campaign panel; follower graph stays seeded mock data

### Changed
- Campaign loop is no longer automatic — ops still ships features; posting
  waits for Start. Boot sim is idle (queued empty drafts). Terac returns to
  the Overview org chart. Agent count 34 → 35

## [0.3.0.0] - 2026-08-15

### Added
- Audience campaign sim: Audience Scraper pulls followers from X and groups
  them into five clusters; five writer agents (Direct, Receipts, Operator,
  Narrative, Hook) each draft a post for the business account; nine juror
  agents cloned from top-engagement followers vote, plurality wins, Publisher
  posts the winner to X
- Audience Map: click a follower to pin their username, handle, cluster, and
  juror status; live sim panel under the map shows the pull, the five drafts,
  and the nine votes landing one at a time

### Changed
- Marketing loop is the 5-writer / 9-juror sim — no 10-variant A/B stub, no
  human (Terac) escalation. Agent count 21 → 34. Overview drops Terac Liaison
  and relabels Content Studio → Writer Bench, Persona Sim → Jury

## [0.2.0.0] - 2026-08-15

### Added
- Mode 6 Competition: three autonomous intel tracker agents scanning rival
  companies (Loopwork, Autonomo, DriftOS) on an independent loop — threat
  levels, capability matrix synced to our shipped features (cells flash on
  change), and an intel feed where the Diff Analyst + CEO attach a
  counter-move to every detected rival move
- Mode 7 Investment: five-persona committee (Prudence, Momentum, Quant,
  Runway Guardian, Yield Scout) governing the treasury on its own loop —
  proposals from a pool, votes landing sequentially with reasoning, majority
  execution against the allocation bar, decision history including rejections
- Engine: two new guarded agent loops, treasury state with
  allocations-sum-to-cash invariant, intel/proposal records, capability sync
  on feature ship, agent count 12 → 21, new ledger billing for Intel Tracker /
  Diff Analyst / Investment Committee
- Six new tests covering matrix consistency, treasury invariants, and
  committee vote completeness

## [0.1.1.0] - 2026-08-14

### Added
- Mode 5 Ledger: dense money ledger (rail marks, inflows in green, running
  balance, TEST MODE chip), per-call LLM spend ledger with totals, the
  "This company cost $X to operate today" kicker and spend-by-department
  donut, and the post strip with predicted-vs-actual engagement bars
  (green check on hits, honest gray dash on misses)
- Engine: transaction records with running balance, per-call LLM ledger rows
  attributed to agents/providers/models, post records whose actual engagement
  trickles in after publishing
- Four new ledger invariant tests (running-balance consistency, spend total,
  department attribution, honest-miss seeding)

## [0.1.0.0] - 2026-08-14

### Added
- Simulated company engine: jittered scripted loop (repo scan → merge detected →
  CEO decision → marketing swarm → A/B sim → post → payments → forecast → loop
  closes) driving every UI surface, with Terac human-escalation beats
- Mode 1 Overview: org chart with department quadrants, node states (idle /
  thinking arc-sweep / acting chips), edge particles, activity feed with
  evidence chips, MRR ticker with sparkline, full-cycle loop counter
- Mode 2 Audience Map: 1,005 seeded followers force-laid into organic clusters,
  legend dim interaction, natural-language Ask query stub, pan/zoom, persona
  hover cards
- Mode 3 Product: three-column feature kanban (Shipped / In Progress /
  Claimed-only) with evidence-chip receipts, live ship banner with
  Detected → Campaign → Simulated → Posted breadcrumb, FLIP column moves,
  repo health strip
- Mode 4 Finance: revenue chart with P10–P90 forecast fan, campaign markers
  with cause→effect underlines, five-model forecaster ensemble with
  disagreement gauge, confidence-weighted aggregation receipt, generated
  forecast report with per-rail totals
- White-paper design system: tokens, tabular numerals, single shadow depth,
  department accent colors, motion only on data flow
- Vitest suite covering the simulation engine, audience generation, and
  finance history math

### Changed
- Draft PR numbers carry through to shipped feature cards so evidence chains
  stay consistent
