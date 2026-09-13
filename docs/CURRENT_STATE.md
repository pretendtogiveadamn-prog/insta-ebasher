# Current state

Verified: 2026-09-13.

- The active deliverable is `D:\\codexprojects\\insta-ebasher`.
- Local-only Express backend, SQLite CRM, Server-Sent Events panel updates and Telegram notification delivery are implemented.
- There is no browser launcher, proxy, cookie store, persistent browser profile, anti-detect package, Patchright or Playwright dependency.
- Implemented V1: research jobs and candidate evidence, review/DNC, approved lead to campaign, one-target action leases, 35/24h server quota, inbox parsing, phone/email/opt-out state, panel plus Telegram alert attempt.
- `npm run check` passes: TypeScript build and two CRM flow tests.
- Chrome MCP must still be attached by the operator. The backend cannot inspect or launch it; a fresh agent heartbeat is required before a DM or inbox lease.
- Telegram works only after the operator creates an untracked `.env` with token and chat ID. Without it alerts persist locally as `not_configured`.
