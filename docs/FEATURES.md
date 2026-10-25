# Client panel QA — 2026-10-25

Scope: local client outreach UI and its agent CLI. Synthetic SQLite data only; no real Instagram messages were sent.

| Flow | Result | Evidence |
|---|---|---|
| Overview and navigation | Pass | Desktop 1440px and mobile 390px browser checks, four sections, no JS errors or horizontal overflow |
| CRM review, reject, do-not-contact, research job | Pass | Browser clicked controls against isolated API; persisted lead counts and job checked |
| Full CRM and ready-lead search and pagination | Pass | 513 CRM leads / 510 ready; first 100 shown, global search found oldest handle, next 100 loaded in both views |
| Select all and exclude one | Pass | Saved campaign with 509 recipients; unit test also covers unseen pages |
| Message draft preview and editing | Pass | Preview uses selected handle; browser saved edited template; edit invalidates prior preview in unit test |
| Sender account add/switch | Pass | UI controls with mocked accounts; isolated API/CLI switched two real SQLite account records |
| Preview gate and live controls | Pass with environment limit | Browser requests and state mocked; backend maps v2 sender to V1 preview account ID; switch invalidation verified via isolated API and unit test |
| Stop and disable | Pass with environment limit | Browser stop request mocked; CLI/server gate reviewed and mailer unit suite passed |
| Actual logged-in Instagram Chrome dry-run and live DM | Awaiting owner session | Requires client's own logged-in sender window; no real DM was sent during QA |

Verification: root `npm run check` 62/62, `mailer/npm test` 150/150. Main browser flow and supplementary CRM/button flow passed. The actual Instagram DOM and account identity still require an owner-controlled dry-run.
