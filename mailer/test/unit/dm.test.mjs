import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../src/core/db.mjs";
import { precheck, runDmFlow, contractsForMode } from "../../src/flows/dm.mjs";
import { addAccount } from "../../src/orch/accounts.mjs";
import { withFakeDom } from "./helpers/fake-dom.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freshDb() {
  const db = openDb(join(tmpdir(), `ih-dm-${Date.now()}-${Math.random().toString(36).slice(2)}/t.db`));
  addAccount(db, { id: "acc1", antyProfileId: "p1", dailyCap: 25 });
  return db;
}

function makeLead(db, { status = "ready", draft = "yo dark type beat", handle = "artist_x", sentToday = 0 } = {}) {
  db.prepare("INSERT INTO leads (id, handle, status, draft) VALUES ('l1', ?, ?, ?)").run(handle, status, draft);
  for (let i = 0; i < sentToday; i++) {
    db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, dry_run, sent_at) VALUES ('acc1', 'other', 'sent', 0, ?)").run(new Date().toISOString());
  }
  return db.prepare("SELECT * FROM leads WHERE id='l1'").get();
}

const sleep0 = async () => {};

test("precheck: готовый dry-run проходит", () => {
  const db = freshDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const lead = makeLead(db);
  const pc = precheck({ db, account, lead, mode: "dry_run" });
  assert.equal(pc.sentToday, 0);
  assert.equal(pc.cap, 25);
});

test("precheck: lead не ready → fail-closed (LLM-вердикт обязателен)", () => {
  const db = freshDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const lead = makeLead(db, { status: "new" });
  assert.throws(() => precheck({ db, account, lead, mode: "dry_run" }), (e) => e.code === "SessionError" && /ready/.test(e.message));
});

test("precheck: cap исчерпан → SessionError", () => {
  const db = freshDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const lead = makeLead(db, { sentToday: 25 });
  assert.throws(() => precheck({ db, account, lead, mode: "dry_run" }), (e) => e.code === "SessionError" && /cap/.test(e.message));
});

test("precheck: cooldown → ActionBlockError", () => {
  const db = freshDb();
  db.prepare("UPDATE accounts SET cooldown_until='2099-01-01T00:00:00Z', cooldown_reason='test' WHERE id='acc1'").run();
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const lead = makeLead(db);
  assert.throws(() => precheck({ db, account, lead, mode: "dry_run" }), (e) => e.code === "ActionBlockError");
});

test("precheck: live проходит когда контракты verified (пост-bootstrap 2026-09-25)", () => {
  const db = freshDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const lead = makeLead(db);
  assert.doesNotThrow(() => precheck({ db, account, lead, mode: "live" }));
});

test("contractsForMode: dry-run разрешён всегда; live-гейт следит за verified", () => {
  const dry = contractsForMode(true);
  assert.equal(dry.gate.ok, true);
  // после аудита 2026-09-25 profile/thread/login verified; send-confirm — только после canary
  const live = contractsForMode(false);
  for (const m of live.gate.missing) assert.ok(m.startsWith("send-confirm/"), m);
});

test("contractsForMode: canary — send-confirm не требуется, остальное verified", () => {
  const c = contractsForMode(false, { canary: true });
  assert.ok(c.gate.missing.every((m) => !m.startsWith("send-confirm/")));
  const cDry = contractsForMode(true, { canary: true });
  assert.equal(cDry.gate.ok, true);
});

// ── runDmFlow с mock-страницей (dry-run, happy path) ──
const DOM_OK = {
  headerHref: "/artist_x/",
  headerText: "@artist_x • 1,2K followers",
  bodyText: "Artist X\nFollow\nMessage",
  statusIcons: [],
  postLinks: 3,
};

function mockPage(html = DOM_OK) {
  const page = {
    _html: html,
    url: () => html.url ?? "https://www.instagram.com/direct/t/123/",
    history: [],
    clicks: [],
    keyboard: { pressed: [], press(k) { this.pressed.push(k); } },
    on() {},
    off() {},
    async goto(u) { this.history.push(u); html.url = u; },
    async waitForURL() {},
    async reload() {},
    async goBack() {},
    async screenshot() {},
    evaluate: async (fn, arg) => {
      // deepQuery: дефолтный кандидат — h1 профиля (waitProfileReady должен видеть живую страницу)
      if (arg && arg.cssSelector !== undefined) {
        return [{ tag: "h1", classes: [], text: html.headerText ?? "", ariaLabel: null, role: null, visible: true, disabled: false, ancestors: ["header", "main"] }];
      }
      const g = globalThis;
      const sd = g.document;
      const sl = g.location;
      g.document = {
        body: { innerText: html.bodyText ?? "" },
        title: html.title ?? `${html.headerText ?? ""} (@${(html.headerHref ?? "/artist_x/").replace(/\//g, "")}) • Instagram`,
        querySelector: (sel) => {
          if (sel === "header a[href^='/']") return { getAttribute: () => html.headerHref };
          if (sel === "header h2, header span" || sel === "header h2") return { innerText: html.headerText, textContent: html.headerText };
          if (sel === "div[role='dialog']") return html.dialogText !== undefined ? { innerText: html.dialogText } : null;
          return null;
        },
        querySelectorAll: (sel) => {
          if (sel === "header a[href^='/']") return html.headerHref ? [{ getAttribute: () => html.headerHref }] : [];
          if (sel === "svg[aria-label]") return (html.statusIcons ?? []).map((label) => ({ getAttribute: () => label }));
          if (sel === "div[role='dialog'] img") return Array.from({ length: html.gridImgs ?? 0 }, () => ({}));
          if (sel === "a[href]") return (html.profileLinks ?? ["/artist_x/"]).map((h) => ({ getAttribute: () => h }));
          if (sel === "div[dir='auto']") return (html.bubbles ?? (html.bodyText ? [html.bodyText] : [])).map((t) => ({ textContent: t }));
          if (sel === "div[contenteditable='true']") return [{ getAttribute: () => "true", className: "composer-cls", tag: "div" }];
          if (sel.startsWith("div[role=") || sel.includes("button")) {
            if (html.rows) {
              return html.rows.map((spans) => ({
                getAttribute: () => null,
                className: "row",
                tag: "div",
                textContent: spans.join(""),
                querySelectorAll: () => spans.map((s) => ({ textContent: s })),
                getBoundingClientRect: () => ({ x: 10, y: 10, width: 200, height: 48 }),
              }));
            }
            return [{ getAttribute: () => null, className: "msg-btn", tag: "div", textContent: html.bodyText, querySelectorAll: () => [], getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) }];
          }
          return [];
        },
      };
      try {
        g.location = new URL(html.url ?? "https://www.instagram.com/artist_x/");
        return await fn(arg);
      } finally {
        g.document = sd;
        g.location = sl;
      }
    },
  };
  return page;
}

// mock resolver: профиль-зона находит button/composer через deepQuery — подменяем
// resolveOnPage не напрямую; для happy-path dry-run просто подменяем зоны через deps.zones
test("runDmFlow dry-run happy path: S0→S7_dry_run_stop, Enter НЕ нажат", async () => {
  const db = freshDb();
  const lead = makeLead(db);
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const page = mockPage({ ...DOM_OK });
  // deepQuery-кандидаты для контрактного резолва (h1 профиля + кнопка Message + composer)
  const CANDIDATES = [
    { tag: "h1", classes: [], text: "artist_x", ariaLabel: null, role: null, visible: true, disabled: false, ancestors: ["header", "main"] },
    { tag: "div", classes: ["msg-btn"], text: "Message", ariaLabel: null, role: "button", visible: true, disabled: false, ancestors: ["main", "header"] },
    { tag: "div", classes: ["composer-cls"], ariaLabel: null, role: "textbox", visible: true, disabled: false, ancestors: ["div"] },
  ];
  const origEvaluate = page.evaluate.bind(page);
  page.evaluate = async (fn, arg) => {
    if (arg && arg.cssSelector !== undefined) return CANDIDATES; // deepQuery → canned
    return origEvaluate(fn, arg);
  };
  const zones = contractsForMode(true).zones;
  const res = await runDmFlow({
    client: null,
    profileId: "p1",
    account,
    lead,
    db,
    logger: () => {},
    stateDir: join(tmpdir(), "ih-ev-dm"),
    dryRun: true,
    zones,
    page,
    human: mockHuman(),
    sleepFn: sleep0,
  });
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.ok(res.steps.includes("S7_dry_run_stop"));
  assert.equal(page.keyboard.pressed.includes("Enter"), false);
  assert.equal(page.typed, "yo dark type beat");
});

function mockHuman() {
  return {
    async dwell() {},
    async clickCandidate() { return false; }, // без box — фолбэк на clickSelector
    async clickSelector(page, sel) {
      page.clicks.push(sel);
      // клик по Message-кнопке → открывается тред (мок SPA-перехода)
      if (page.clicks.length === 1 && page._html) page._html.url = "https://www.instagram.com/direct/t/123/";
    },
    async typeText(page, text) { page.typed = text; },
    async linger() {},
    async pause() {},
  };
}

// E2E-прогон state-machine с прямым mockPage, где резолв подменён на готовый candidate
test("runDmFlow: wrong recipient → RecipientResolutionError fail-closed", async () => {
  const db = freshDb();
  const lead = makeLead(db, { handle: "expected_artist" });
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const page = mockPage({ ...DOM_OK, headerHref: "/wrong_guy/", headerText: "@wrong_guy" });
  const res = runDmFlow({
    client: null,
    profileId: "p1",
    account,
    lead,
    db,
    logger: () => {},
    stateDir: join(tmpdir(), "ih-ev-dm"),
    dryRun: true,
    zones: contractsForMode(true).zones,
    page,
    human: mockHuman(),
    sleepFn: sleep0,
  });
  await assert.rejects(res, (e) => e.code === "RecipientResolutionError");
});

// ── waitThreadOpen / verifyThreadRecipient (S5 надёжность, баг ложного /direct/new/) ──
import { waitThreadOpen, verifyThreadRecipient } from "../../src/flows/dm.mjs";

test("waitThreadOpen: /direct/t/<id> — ok по url", async () => {
  const page = { url: () => "https://www.instagram.com/direct/t/42/", evaluate: async () => { throw new Error("dom dead"); } };
  const r = await waitThreadOpen(page, { timeoutMs: 300, pollMs: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.via, "url");
});

test("waitThreadOpen: /direct/new/ БЕЗ composer'а — НЕ тред (анти-ложный-позитив, баг 2026-09-24)", async () => {
  const page = { url: () => "https://www.instagram.com/direct/new/", evaluate: async () => false };
  const r = await waitThreadOpen(page, { timeoutMs: 120, pollMs: 20 });
  assert.equal(r.ok, false);
});

test("waitThreadOpen: composer виден на /direct/* — тред открыт (in-place вариант)", async () => {
  const page = {
    url: () => "https://www.instagram.com/direct/new/",
    evaluate: async (fn) => String(fn).includes("textbox"), // composer-probe → true
  };
  const r = await waitThreadOpen(page, { timeoutMs: 300, pollMs: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.via, "composer");
});

test("verifyThreadRecipient: exact /handle/ → ok; похожий хэндл → не ok (TRAPS #5)", async () => {
  const mk = (links) => ({ evaluate: async () => ({ links, headerText: "" }) });
  const fast = { timeoutMs: 60, pollMs: 10, sleepFn: sleep0 };
  assert.equal((await verifyThreadRecipient(mk(["polynoire01", "deezzo_prod3"]), "deezzo_prod3", fast)).ok, true);
  assert.equal((await verifyThreadRecipient(mk(["polynoire01", "deezzo_prod"]), "deezzo_prod3", fast)).ok, false);
  assert.equal((await verifyThreadRecipient(mk([]), "deezzo_prod3", fast)).ok, false); // fail-closed
});

// ── нет Message-кнопки → RecipientResolutionError, route B НЕ используется (owner 2026-09-25) ──
test("runDmFlow: нет Message-кнопки → failed, /direct/new/ НЕ открываем", async () => {
  const db = freshDb();
  const lead = makeLead(db, { handle: "deezzo_prod3" });
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const page = mockPage({
    ...DOM_OK,
    headerHref: "/deezzo_prod3/",
    headerText: "@deezzo_prod3",
    profileLinks: ["/deezzo_prod3/"],
  });
  await assert.rejects(
    runDmFlow({
      client: null, profileId: "p1", account, lead, db, logger: () => {},
      stateDir: join(tmpdir(), "ih-ev-dm"), dryRun: true, zones: contractsForMode(true).zones,
      page, human: mockHuman(), sleepFn: sleep0, homeExitFn: async () => {},
    }),
    (e) => e.code === "RecipientResolutionError" && /Message/.test(e.message)
  );
  assert.equal(page.history.some((u) => u.includes("/direct/new/")), false, "route B запрещён");
});

// ── S6 дубль-чек: наш текст уже в переписке → skipped, Enter НЕ нажат ──
test("runDmFlow: дубль-чек — draft уже в треде → skipped=duplicate, не печатаем", async () => {
  const db = freshDb();
  const lead = makeLead(db);
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const page = mockPage({ ...DOM_OK, bodyText: "Artist X\nMessage\nyo dark type beat" }); // тред уже содержит наш текст
  const CANDIDATES = [
    { tag: "h1", classes: [], text: "artist_x", ariaLabel: null, role: null, visible: true, disabled: false, ancestors: ["header", "main"] },
    { tag: "div", classes: ["msg-btn"], text: "Message", ariaLabel: null, role: "button", visible: true, disabled: false, ancestors: ["main", "header"] },
    { tag: "div", classes: ["composer-cls"], ariaLabel: null, role: "textbox", visible: true, disabled: false, ancestors: ["div"] },
  ];
  const origEvaluate = page.evaluate.bind(page);
  page.evaluate = async (fn, arg) => (arg && arg.cssSelector !== undefined ? CANDIDATES : origEvaluate(fn, arg));
  const res = await runDmFlow({
    client: null, profileId: "p1", account, lead, db, logger: () => {},
    stateDir: join(tmpdir(), "ih-ev-dm"), dryRun: true, zones: contractsForMode(true).zones,
    page, human: mockHuman(), sleepFn: sleep0, homeExitFn: async () => {},
  });
  assert.equal(res.skipped, "duplicate");
  assert.equal(page.typed, undefined); // не печатали
  assert.equal(page.keyboard.pressed.includes("Enter"), false);
});

// ── S5 can-message детект: рестрикшн в чате → DmRestrictedError (аккаунт не штрафуется) ──
test("runDmFlow: «can't message» в открытом чате → DmRestrictedError fail-closed", async () => {
  const db = freshDb();
  const lead = makeLead(db);
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const page = mockPage({ ...DOM_OK, bodyText: "Artist X\nYou can't message this account" });
  const CANDIDATES = [
    { tag: "h1", classes: [], text: "artist_x", ariaLabel: null, role: null, visible: true, disabled: false, ancestors: ["header", "main"] },
    { tag: "div", classes: ["msg-btn"], text: "Message", ariaLabel: null, role: "button", visible: true, disabled: false, ancestors: ["main", "header"] },
    { tag: "div", classes: ["composer-cls"], ariaLabel: null, role: "textbox", visible: true, disabled: false, ancestors: ["div"] },
  ];
  const origEvaluate = page.evaluate.bind(page);
  page.evaluate = async (fn, arg) => (arg && arg.cssSelector !== undefined ? CANDIDATES : origEvaluate(fn, arg));
  await assert.rejects(
    runDmFlow({
      client: null, profileId: "p1", account, lead, db, logger: () => {},
      stateDir: join(tmpdir(), "ih-ev-dm"), dryRun: true, zones: contractsForMode(true).zones,
      page, human: mockHuman(), sleepFn: sleep0, homeExitFn: async () => {}, homeExitFn: async () => {},
    }),
    (e) => e.code === "DmRestrictedError"
  );
});

// ── cooldownOnFeed: кд на ленте, action-block в кд → стоп ──
import { cooldownOnFeed } from "../../src/flows/dm.mjs";

test("cooldownOnFeed: отрабатывает дедлайн и выходит (тихое ожидание, без робо-скролла)", async () => {
  let moves = 0;
  const page = { evaluate: async () => "" };
  const h = { moveTo: async () => moves++ };
  await cooldownOnFeed(page, h, 0.05, { sleepFn: sleep0 });
  // завершилось без ошибок; moveTo — опциональные микродвижения (рандом < 0.4)
});

test("cooldownOnFeed: action-block баннер во время кд → ActionBlockError (fail-closed)", async () => {
  const page = { evaluate: async () => "Youre temporarily blocked from messaging" };
  await assert.rejects(cooldownOnFeed(page, {}, 5, { sleepFn: sleep0 }), (e) => e.code === "ActionBlockError");
});

const fakeRowsPage = (rows) => ({
  evaluate: async (fn, t) => {
    const sd = globalThis.document;
    globalThis.document = {
      querySelectorAll: () =>
        rows.map((spans) => ({
          querySelectorAll: () => spans.map((s) => ({ textContent: s })),
          getBoundingClientRect: () => ({ x: 1, y: 1, width: 100, height: 40 }),
          textContent: spans.join(""),
        })),
    };
    try {
      return await fn(t);
    } finally {
      globalThis.document = sd;
    }
  },
});

test("findExactResultRow: handle в спане ряда (display name сверху, textContent склеен) — баг 22k_dooter", async () => {
  const { findExactResultRow } = await import("../../src/flows/dm.mjs");
  const page = fakeRowsPage([
    ["Allstar Shawn", "22k_dooter", "You both follow rmc_mike and 2 others"],
    ["Some Other", "someone_else"],
  ]);
  const row = await findExactResultRow(page, "22k_dooter");
  assert.ok(row?.box, "ряд со спаном exact-handle должен матчиться");
  assert.match(row.text, /Allstar Shawn/);
});

test("findExactResultRow: НЕ матчит follow-упоминание (TRAPS #5)", async () => {
  const { findExactResultRow } = await import("../../src/flows/dm.mjs");
  const page = fakeRowsPage([["Fan Page", "You both follow 22k_dooter and 3 others"]]);
  const row = await findExactResultRow(page, "22k_dooter");
  assert.equal(row, null, "упоминание в follow-строке ≠ ряд аккаунта");
});
