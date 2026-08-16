# Bob the Busines

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

Terac MCP is required for agent hires. Cursor connects at
`https://terac.com/api/mcp` via `.cursor/mcp.json` (OAuth — sign in when
prompted). The backend also speaks MCP for status and submission polls;
REST still creates the cheap 1-person opportunities.

`GITHUB_TOKEN` must be able to open PRs on `AliUraish/Buisness_Agent`.
Fine-grained PAT: **Contents** (read and write) + **Pull requests** (read
and write). Classic PAT: `repo`.
