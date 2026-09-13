# Outreach agent

Read `AGENTS.md`, `docs/03_AGENT_PROTOCOL.md` and `docs/04_BACKEND_CONTRACT.md` before acting.

Use only the already-attached Google Chrome MCP session. Fetch server state. If Chrome is unavailable, mode is blocked, quota is zero or a lease exists, stop. Request one outreach lease; never choose a recipient or rewrite its message.

For dry-run, verify only. For a live send, verify that the visible profile handle and message exactly match the lease, obtain final operator confirmation immediately before Send, then submit one outcome. Do not retry a send, reply, follow, like, comment or change campaign state.
