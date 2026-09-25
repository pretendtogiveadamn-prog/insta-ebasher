import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCaptcha, captchaPolicy, captchaGate, captchaCountToday, waitForManualSolve } from "../../src/flows/captcha.mjs";
import { withFakeDom } from "./helpers/fake-dom.mjs";
import { openDb } from "../../src/core/db.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function pageWith({ url = "https://instagram.com/joe/", dialogText = null, gridImgs = 0, bodyText = "" }) {
  const fakeUrl = new URL(url);
  return {
    url: () => url,
    evaluate: async (fn, arg) => {
      // эмулируем page.evaluate: глобальный document/location
      const g = globalThis;
      const savedDoc = g.document;
      const savedLoc = g.location;
      g.document = {
        body: { innerText: bodyText },
        querySelector: (sel) => (sel === "div[role='dialog']" && dialogText !== null ? { innerText: dialogText } : null),
        querySelectorAll: (sel) => (sel === "div[role='dialog'] img" ? Array.from({ length: gridImgs }, () => ({})) : []),
      };
      try {
        g.location = fakeUrl;
        return await fn(arg);
      } finally {
        g.document = savedDoc;
        g.location = savedLoc;
      }
    },
  };
}

test("captcha детект: URL /challenges/", async () => {
  const det = await detectCaptcha(pageWith({ url: "https://instagram.com/challenges/123/" }));
  assert.equal(det.detected, true);
  assert.equal(det.kind, "challenge_url");
});

test("captcha детект: modal 'Confirm your requests'", async () => {
  const det = await detectCaptcha(pageWith({ dialogText: "Confirm your requests to send messages" }));
  assert.equal(det.detected, true);
  assert.equal(det.kind, "confirm_requests_modal");
});

test("captcha детект: photo-grid в модалке (>=4 img)", async () => {
  const det = await detectCaptcha(pageWith({ dialogText: "Choose photos", gridImgs: 6 }));
  assert.equal(det.detected, true);
  assert.equal(det.kind, "photo_grid");
});

test("captcha нет на обычном профиле", async () => {
  const det = await detectCaptcha(pageWith({}));
  assert.equal(det.detected, false);
});

test("policy: 1-я капча → manual_solve, 2-я+ → stop_and_cooldown", () => {
  assert.equal(captchaPolicy(0), "manual_solve");
  assert.equal(captchaPolicy(1), "stop_and_cooldown_24h");
  assert.equal(captchaPolicy(3), "stop_and_cooldown_24h");
});

test("captchaGate: 2-я капча → CaptchaError", () => {
  assert.throws(() => captchaGate({ detected: true, countToday: 1 }), (e) => e.code === "CaptchaError");
  assert.deepEqual(captchaGate({ detected: true, countToday: 0 }), { action: "manual_solve" });
  assert.deepEqual(captchaGate({ detected: false, countToday: 5 }), { action: "proceed" });
});

test("captchaCountToday по outreach_log", () => {
  const db = openDb(join(tmpdir(), `ih-captcha-${Date.now()}/t.db`));
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, sent_at) VALUES ('a','l','captcha',?)").run(new Date().toISOString());
  assert.equal(captchaCountToday(db, "a"), 1);
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, sent_at) VALUES ('a','l2','sent',?)").run(new Date().toISOString());
  assert.equal(captchaCountToday(db, "a"), 1);
});

test("waitForManualSolve: динамический DOM решён owner'ом → solved", async () => {
  const state = { solved: false, onChallenges: true };
  const p = {
    url: () => (state.onChallenges ? "https://instagram.com/challenges/1/" : "https://instagram.com/joe/"),
    evaluate: async (fn, arg) => {
      const g = globalThis;
      const savedDoc = g.document;
      const savedLoc = g.location;
      const det = state.solved
        ? { dialogText: null, gridImgs: 0, bodyText: "" }
        : { dialogText: "Confirm your requests", gridImgs: 6, bodyText: "" };
      g.document = {
        body: { innerText: det.bodyText },
        querySelector: (sel) => (sel === "div[role='dialog']" && det.dialogText !== null ? { innerText: det.dialogText } : null),
        querySelectorAll: (sel) => (sel === "div[role='dialog'] img" ? Array.from({ length: det.gridImgs }, () => ({})) : []),
      };
      try {
        g.location = new URL(state.onChallenges ? "https://instagram.com/challenges/1/" : "https://instagram.com/joe/");
        return await fn(arg);
      } finally {
        g.document = savedDoc;
        g.location = savedLoc;
      }
    },
  };
  // owner «решает» капчу после первого опроса: URL уходит с /challenges/, DOM очищается
  let polls = 0;
  const origUrl = p.url.bind(p);
  p.url = () => {
    const u = origUrl();
    if (++polls >= 1) {
      state.solved = true;
      state.onChallenges = false;
    }
    return u;
  };
  const r = await waitForManualSolve(p, { timeoutMs: 5000, pollMs: 10, sleepFn: async () => {} });
  assert.equal(r.solved, true);
});

test("waitForManualSolve: таймаут → CaptchaError (retriable=false)", async () => {
  const p = pageWith({ dialogText: "Confirm your requests", gridImgs: 6 });
  await assert.rejects(
    waitForManualSolve(p, { timeoutMs: 100, pollMs: 10, sleepFn: async () => {} }),
    (e) => e.code === "CaptchaError" && e.retriable !== true
  );
});
