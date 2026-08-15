# ZeroCo

Two processes. Keep them that way.

| Package | What it is |
| --- | --- |
| `cockpit/` | Frontend — ops terminal, simulation, UI |
| `backend/` | API — secrets, Terac hires, vendor calls |

```bash
# terminal 1
cd backend && npm install && npm run dev

# terminal 2
cd cockpit && npm install && npm run dev
```

Workspace env lives in `.env` (never commit it). `TERAC_API_KEY` is read only
by the backend. Cockpit proxies `/api` to `http://127.0.0.1:8787` in dev.
