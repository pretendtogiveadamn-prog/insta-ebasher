import { test } from "node:test";
import assert from "node:assert/strict";
import { AntyClient, ensureAttachable, cdpAlive } from "../../src/browser/anty.mjs";

function makeClient(overrides = {}) {
  const state = {
    profiles: {
      p1: { id: "p1", name: "test-1", running: false, cdpPort: null, proxy: { value: "u:p@1.1.1.1:8080" } },
      p2: { id: "p2", name: "test-2", running: true, cdpPort: 59701 },
      p3: { id: "p3", name: "test-3", running: true, cdpPort: 19402 },
      ...overrides,
    },
  };
  const client = new AntyClient({
    fetchImpl: async (url, opts = {}) => {
      const path = new URL(url).pathname;
      const auth = opts.headers?.Authorization ?? "";
      const json = (data, status = 200) => ({ ok: status < 400, status, statusText: "ok", json: async () => data });
      if (path === "/api/profiles/p1" && opts.method === "POST" && !state.profiles.p1.running) {
        state.profiles.p1 = { ...state.profiles.p1, running: true, cdpPort: 19400 };
        return json(state.profiles.p1);
      }
      if (path === "/api/profiles/p1/open") {
        if (state.openFail) return json({ ok: false, error: "proxy gate failed" });
        state.profiles.p1 = { ...state.profiles.p1, running: true, cdpPort: 19400 };
        return json(state.profiles.p1);
      }
      if (path === "/api/profiles") return json({ profiles: Object.values(state.profiles) });
      const m = /^\/api\/profiles\/(\w+)$/.exec(path);
      if (m) return json(state.profiles[m[1]] ?? null);
      return json({ error: "no route" }, 404);
    },
  });
  return { client, state };
}

test("anty: unauthorized без токена (401)", async () => {
  const { client } = makeClient();
  // перезаписываем fetch, чтобы вернуть 401
  client.fetch = async () => ({ ok: false, status: 401, statusText: "unauthorized", json: async () => ({}) });
  await assert.rejects(client.health(), /unauthorized/);
});

test("ensureAttachable: не running → open + poll до живого CDP", async () => {
  const { client } = makeClient();
  const res = await ensureAttachable(client, "p1", { pollMs: 1, waitMs: 500, cdpAliveFn: async () => true });
  assert.equal(res.openedByBot, true);
  assert.equal(res.profile.cdpPort, 19400);
});

test("ensureAttachable: open ok:false → fail-closed", async () => {
  const { client, state } = makeClient();
  state.openFail = true;
  let err;
  try {
    await ensureAttachable(client, "p1", { pollMs: 1, waitMs: 100 });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "должен бросить");
  assert.equal(err.failClosed, true);
});

test("ensureAttachable: running но CDP мёртв → ошибка (не re-open)", async () => {
  const { client } = makeClient();
  await assert.rejects(ensureAttachable(client, "p2", { pollMs: 1, cdpAliveFn: async () => false }), /не отвечает/);
});

test("cdpAlive: null на недоступном порту", async () => {
  const r = await cdpAlive(59999, { timeoutMs: 300 });
  assert.equal(r, null);
});
