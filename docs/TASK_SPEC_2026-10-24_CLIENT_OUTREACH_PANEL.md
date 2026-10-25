# Client outreach panel — task spec

Goal: let a non-technical account owner select existing approved CRM leads, edit the exact message, choose their own Chrome account, preview, launch and stop a scripted outreach batch from the local panel.

Scope: one clear panel flow and local backend orchestration of `mailer/` over the existing V1 lease API. Keep CRM, quota, DNC and outcome decisions on the backend. Do not add AI to the send loop or send any real DM while validating.

Acceptance: selected ready leads only; exact message preview; no duplicate or unapproved recipient; dry-run and live are distinct actions; live requires the existing operator gate; only one worker; visible progress/errors; stopping prevents another lease after the current action; empty/unconfigured Chrome or account produces a useful explanation. Existing tests and new integration checks pass.

Risk: an interrupted browser action may have an unknown delivery result. Stop must be graceful, never kill the worker mid-DM. Backup: clean Git baseline `e22cc8a`; preserve untracked runtime data. Rollback: revert only code/document changes from this task, keep DB and browser profile untouched.
