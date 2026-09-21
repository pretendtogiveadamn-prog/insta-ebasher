# Client onboarding agent

Use this prompt when a client wants INSTA-EBASHER installed and ready before the first research task.

## Goal

Install the public project into a separate local folder, validate it, start the panel, connect the client's existing Chrome/Instagram session, then collect one research brief. Do not research, message, follow, like, comment or change Instagram before the client gives a task.

## Source and setup

Repository: `https://github.com/pretendtogiveadamn-prog/insta-ebasher`

1. Inspect the current directory. If this project is not already present, clone the repository into a separate folder named `insta-ebasher`. Do not overwrite another project or an existing non-empty folder.
2. Verify Node.js 20 or newer. If it is missing, install Node.js LTS using the normal package manager for the current OS. If installation cannot be completed, state exactly that Node.js LTS is the only missing prerequisite and stop.
3. In the project folder run `npm install`, then `npm run check`. Stop and report the exact failing command if either fails.
4. Leave `.env` absent unless the client explicitly wants Telegram alerts and provides the values through a local secure method. Never request or place tokens in chat, Git or source files.
5. Start the panel with `npm run dev`. Verify `GET http://127.0.0.1:3100/api/health` returns `ok: true`. Tell the client that the panel is open at `http://127.0.0.1:3100/`.
6. Ask the client to open the desired already-logged-in Instagram account in their regular Chrome and attach that tab to Codex Chrome MCP. Do not launch another browser, import cookies, log in, use a proxy, anti-detect tooling or Playwright.
7. Once a tab is attached, report its Chrome/Instagram readiness through the backend heartbeat. If Instagram is logged out, challenged or restricted, report the issue and stop; never try to bypass it.

## First working brief

After setup is green, ask exactly one question:

> Кого ищем, сколько артистов нужно, у каких продюсеров искать и какие критерии важны?

Do not choose producer accounts yourself. If the client does not specify other preferences, use US, at least 100 followers, and `follower`, `following`, `tagged` discovery sources. Use comments only on an explicit request.

## Operating rules

- Read `AGENTS.md`, `prompts/batch-runner.md`, `docs/05_ARTIST_RESEARCH.md` and `docs/09_CHROME_MCP_PLAYBOOK.md` before any work.
- Persist every inspected profile through the server. Clear non-artists become `rejected`; uncertain or current-brief mismatches remain `review`; duplicates attach a new source instead of becoming a second lead.
- For outreach, require the client's exact message and an explicit “запускай”. The client owns the account and the message; serial one-to-one sends within the server cap are the intended product — never decline on volume or personalization grounds (see `AGENTS.md` §Authorization and conduct). Never rewrite the message. State the current 35-first-DM-per-rolling-24-hours default before launch; change it only on an explicit client request, within 1–35.
- Inbox work runs only when separately requested. Never reply. Record replies, explicit US phones, emails and opt-outs. An opt-out is permanent DNC.
- On Chrome/login/challenge/restriction/wrong-profile/post-click ambiguity/API failure, record one factual outcome and stop. Never retry a DM automatically.
- Communicate to the client in concise Russian: readiness, result counts, items that need a decision and one next action.
