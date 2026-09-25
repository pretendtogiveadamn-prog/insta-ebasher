import { test } from "node:test";
import assert from "node:assert/strict";
import { V1Bridge, outcomeForV1, isNaturalStop } from "../../src/bridge/v1.mjs";

// mock-fetch: routes вида { "GET /api/agent/state": fn|obj }
function mockFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
    const hit = Object.entries(routes).find(([k]) => {
      const [m, p] = k.split(" ");
      return m === method && (p === path || (p.endsWith("*") && path.startsWith(p.slice(0, -1))));
    });
    if (!hit) return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ error: "no route" }) };
    const res = typeof hit[1] === "function" ? hit[1](calls.at(-1)) : hit[1];
    return res;
  };
  f.calls = calls;
  return f;
}

const json = (obj, status = 200) => ({ ok: status < 400, status, statusText: "OK", json: async () => obj });

test("V1Bridge: getState парсит и возвращает state", async () => {
  const state = { mode: "dry_run", chrome: "available", stopReason: null, quota: { firstDmRemaining: 3 }, activeCampaignId: "c1", activeLease: null };
  const f = mockFetch({ "GET /api/agent/state": json(state) });
  const v1 = new V1Bridge({ baseUrl: "http://127.0.0.1:3000/", fetchImpl: f });
  assert.deepEqual(await v1.getState(), state);
  assert.equal(f.calls[0].method, "GET");
});

test("V1Bridge: пустой baseUrl → fail-closed", () => {
  assert.throws(() => new V1Bridge({ baseUrl: "" }), /baseUrl пуст/);
});

test("V1Bridge: серверная ошибка {error} попадает в v1Message", async () => {
  const f = mockFetch({ "GET /api/agent/state": json({ error: "No running campaign" }, 400) });
  const v1 = new V1Bridge({ baseUrl: "http://x", fetchImpl: f });
  await assert.rejects(() => v1.getState(), (e) => e.v1Message === "No running campaign" && /\/api\/agent\/state/.test(e.message));
});

test("V1Bridge: network-фейл → понятная ошибка", async () => {
  const v1 = new V1Bridge({
    baseUrl: "http://127.0.0.1:1",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  await assert.rejects(() => v1.getState(), /v1 недоступен.*ECONNREFUSED/);
});

test("V1Bridge: heartbeat шлёт валидное тело", async () => {
  const f = mockFetch({ "POST /api/agent/heartbeat": json({ ok: true }) });
  const v1 = new V1Bridge({ baseUrl: "http://x", fetchImpl: f });
  await v1.heartbeat("acc1", "available", "@user");
  assert.deepEqual(f.calls[0].body, { accountId: "acc1", chromeState: "available", username: "@user" });
});

test("V1Bridge: ensureAccount находит по label (без создания)", async () => {
  const f = mockFetch({
    "GET /api/panel/snapshot": json({ accounts: [{ id: "a1", label: "mailer:x", enabled: true }] }),
    "POST /api/accounts": json({ id: "a2", label: "mailer:x" }, 201),
  });
  const v1 = new V1Bridge({ baseUrl: "http://x", fetchImpl: f });
  const acc = await v1.ensureAccount("mailer:x");
  assert.equal(acc.id, "a1");
  assert.ok(!f.calls.some((c) => c.method === "POST"));
});

test("V1Bridge: ensureAccount создаёт если нет", async () => {
  const f = mockFetch({
    "GET /api/panel/snapshot": json({ accounts: [] }),
    "POST /api/accounts": json({ id: "a2", label: "mailer:y" }, 201),
  });
  const v1 = new V1Bridge({ baseUrl: "http://x", fetchImpl: f });
  const acc = await v1.ensureAccount("mailer:y");
  assert.equal(acc.id, "a2");
  assert.deepEqual(f.calls[1].body, { label: "mailer:y" });
});

test("V1Bridge: takeOutreachLease/postOutcome — тела и пути", async () => {
  const lease = { id: "L1", type: "outreach", expiresAt: "soon", dryRun: true, payload: { target: { leadId: "l1", handle: "artist", message: "hi" } } };
  const f = mockFetch({
    "POST /api/agent/outreach-leases": json(lease, 201),
    "POST /api/agent/outreach-leases/L1/outcome": json({ id: "l1" }),
  });
  const v1 = new V1Bridge({ baseUrl: "http://x", fetchImpl: f });
  const got = await v1.takeOutreachLease("acc1");
  assert.equal(got.id, "L1");
  assert.deepEqual(f.calls[0].body, { accountId: "acc1" });
  await v1.postOutcome("L1", { outcome: "previewed", observedHandle: "artist" });
  assert.equal(f.calls[1].path, "/api/agent/outreach-leases/L1/outcome");
  assert.deepEqual(f.calls[1].body, { outcome: "previewed", observedHandle: "artist" });
});

test("outcomeForV1: маппинг v2-кодов на whitelist v1", () => {
  assert.equal(outcomeForV1("RecipientResolutionError"), "target_unavailable");
  assert.equal(outcomeForV1("DmRestrictedError"), "restricted");
  assert.equal(outcomeForV1("SessionError"), "login_required");
  assert.equal(outcomeForV1("ConfirmMissError"), "uncertain");
  assert.equal(outcomeForV1("CaptchaError"), "uncertain");
  assert.equal(outcomeForV1("ActionBlockError"), "failed");
  assert.equal(outcomeForV1("ProxyError"), "failed");
  assert.equal(outcomeForV1("LlmError"), "not_sent");
  assert.equal(outcomeForV1("UnknownCode"), "failed");
});

test("isNaturalStop: распознаёт причины без lease", () => {
  const e = (m) => Object.assign(new Error(m), { v1Message: m });
  assert.ok(isNaturalStop(e("No eligible lead")));
  assert.ok(isNaturalStop(e("No running campaign")));
  assert.ok(isNaturalStop(e("First-DM limit reached")));
  assert.ok(isNaturalStop(e("Active lease exists")));
  assert.ok(isNaturalStop(e("Chrome MCP is not ready")));
  assert.ok(!isNaturalStop(e("Something else")));
  assert.ok(!isNaturalStop(null));
});
