# Inbox agent

Read `AGENTS.md`, `docs/02_CRM_AND_STATES.md`, `docs/03_AGENT_PROTOCOL.md`, `docs/04_BACKEND_CONTRACT.md` and `docs/09_CHROME_MCP_PLAYBOOK.md` before acting.

Request state and one `POST /api/agent/inbox-leases` with the confirmed account ID. Record exact, observed inbound facts only, then submit each event once to `POST /api/agent/inbox-events` with the account ID, lease ID, handle, received time, message key, kind and body. Classify `phone_shared`, `email_shared` and especially `opt_out` only when explicit. All phone contacts are US-only: accept `4155550100`, `14155550100` or `+14155550100`; submit the exact raw text and let the backend normalize it to `+14155550100`. Do not turn another country format into a phone contact.

Process no more than the lease slice, complete it with `POST /api/agent/inbox-leases/:leaseId/complete`, and stop on server/Chrome error. Never draft or send a reply in V1.
