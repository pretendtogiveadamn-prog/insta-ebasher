# Minimal implementation order

Build in this order. Do not start browser work before the server can safely record it.

1. **CRM and audit.** SQLite migrations for lead, evidence, campaign, event, action-lease and immutable audit tables. Implement global handle dedupe and `DO_NOT_CONTACT` first.
2. **State and review API.** Implement research-job creation, candidate validation, review approve/reject and `GET /api/panel/snapshot`.
3. **Lease service.** Implement server state, one active lease per account/task, expiry, quota and one-outcome idempotency. Test all forbidden transitions.
4. **Thin panel.** Display snapshot, review decisions, campaign controls and audit. It submits intent only.
5. **Codex prompts.** Put the repository beside the client workflow; agent reads current state, uses Chrome MCP and posts outcome contracts.
6. **Dry-run validation.** Use the operator's own attached Instagram Chrome. Verify wrong-handle, expired-lease, duplicate, opt-out, quota and Chrome-unavailable cases.
7. **Real-send enablement.** Only after dry-run evidence and operator acceptance. Keep final confirmation and audit enabled.

## Acceptance checks

- A research candidate appears in the panel only after backend validation.
- A human approval is required before an outreach lease can target the lead.
- The agent cannot obtain a lease after quota, opt-out, duplicate or campaign-state blocks.
- The panel reflects one accepted outcome and never invents a sent state.
- Restarting the service preserves CRM/audit but resets live mode safely.
