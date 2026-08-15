# Backend

API for ZeroCo. Owns secrets and live vendor calls. Cockpit talks to this
process over `/api` — it never talks to Terac (or holds `TERAC_API_KEY`) itself.

```bash
npm install
npm run dev
```

Listens on `http://127.0.0.1:8787`. Keys come from the workspace `../.env`.

## Routes

- `GET /api/health`
- `GET /api/linq/status` — `{ live, paymentLink }`
- `POST /api/linq/send` — text the test phone
- `POST /api/linq/onboard` — text the Stripe subscribe link (`STRIPE_PAYMENT_LINK`)
- `POST /api/terac/hires` — create + launch a 1-person claim-review opportunity
- `POST /api/terac/trades` — crypto confidence review (High/Medium/Low)
- `GET /api/terac/trades/:jobId` — poll confidence
- `POST /api/terac/ships` — research→PR verify (Approve / Reject)
- `GET /api/terac/ships/:jobId` — poll that verdict

- `GET /api/x/status` — `{ live, handle, saved, count }`
- `GET /api/x/audience` — returns a saved snapshot if present; otherwise
  fetches @tryterac once from X, writes `data/tryterac-audience.json`, and
  never calls X again until `?refresh=1`
- `GET /api/github/status` — `{ live }`
- `GET /api/github/repos` — the repo in `GITHUB_REPO`
- `GET /api/github/scan` — commits, PRs, extracted features for that repo only

`X_BEARER_TOKEN` comes from `backend/.env` or the workspace `.env`. The
follower endpoint is often locked on cheaper X API tiers; in that case the
route falls back to people who mentioned @tryterac in the last 7 days.

`GITHUB_TOKEN` is required for Product. Set `GITHUB_REPO=owner/name` to the
repo the agents should manage.
