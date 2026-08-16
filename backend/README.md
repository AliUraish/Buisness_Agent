# Backend

API for Bob the Busines. Owns secrets and live vendor calls. Cockpit talks to this
process over `/api` — it never talks to Terac (or holds `TERAC_API_KEY`) itself.

```bash
npm install
npm run dev
```

Listens on `http://127.0.0.1:8787`. Keys come from the workspace `../.env`.

## Routes

- `GET /api/llm/status` — `{ callsUsed, callsMax, remaining, spentUsd }`
- `POST /api/llm/recharge` — `{ pack }` adds to the session call cap (mock)
- `GET /api/health`
- `GET /api/linq/status` — `{ live, paymentLink }`
- `POST /api/linq/send` — text the test phone
- `POST /api/linq/onboard` — text the Stripe subscribe link (`STRIPE_PAYMENT_LINK`)
- `GET /api/terac/status` — `{ live, mcp }` (`mcp` is the Terac MCP handshake)
- `POST /api/terac/hires` — create + launch a 1-person claim-review opportunity
- `POST /api/terac/trades` — crypto confidence review (High/Medium/Low)
- `GET /api/terac/trades/:jobId` — poll confidence
- `POST /api/terac/ships` — research→PR verify (Approve / Reject)
- `GET /api/terac/ships/:jobId` — poll that verdict

- `GET /api/x/status` — `{ live, handle, saved, count }`
- `GET /api/x/audience` — returns a saved snapshot if present; otherwise
  fetches @tryterac once from X, writes `data/tryterac-audience.json`, and
  never calls X again until `?refresh=1`
- `GET /api/github/status` — `{ live, repo, login, canPush, hint, error }`
- `GET /api/github/repos` — the repo in `GITHUB_REPO`
- `GET /api/github/scan` — commits, PRs, extracted features for that repo only
- `POST /api/github/ship` — open a PR under `product/` (does not merge)
- `POST /api/github/merge` — squash-merge after Terac verifies

`X_BEARER_TOKEN` comes from `backend/.env` or the workspace `.env`. The
follower endpoint is often locked on cheaper X API tiers; in that case the
route falls back to people who mentioned @tryterac in the last 7 days.

`GITHUB_TOKEN` is required for Product. The scan and ship loop target
`AliUraish/Buisness_Agent` (`GITHUB_REPO`). Repo Agent opens PRs under `product/`.

### GitHub token permissions

Fine-grained PAT, only on `AliUraish/Buisness_Agent`:

- **Contents** — Read and write (create the `bob/*` branch + file)
- **Pull requests** — Read and write (open and merge the PR)
- **Metadata** — Read (always included)

Classic PAT: `repo` (or `public_repo` if the repo is public).

A token that can only read will scan the board but show **READ ONLY** and
cannot open PRs.
