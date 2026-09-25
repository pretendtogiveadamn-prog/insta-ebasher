import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLead, validateVerdict, applyVerdict, getCached, putCached, buildPrompt, PROMPT_VERSION } from "../../src/llm/pipeline.mjs";
import { cacheKey } from "../../src/llm/client.mjs";
import { openDb } from "../../src/core/db.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const VERDICT = {
  relevance: 0.9,
  category: "artist",
  active: true,
  dm_worth: "yes",
  dm_reason: "uses trap type beats",
  tone: "casual",
  personal_hook: "your 'DARK TYPE BEAT' snippet",
  draft: "yo that dark type beat snippet was crazy, mind if I send you a few?",
};

function freshDb() {
  return openDb(join(tmpdir(), `ih-llm-${Date.now()}-${Math.random().toString(36).slice(2)}/t.db`));
}

test("cacheKey: стабильный sha256(handle|facts|promptVersion)", () => {
  const k1 = cacheKey("joe", { a: 1 }, PROMPT_VERSION);
  const k2 = cacheKey("joe", { a: 1 }, PROMPT_VERSION);
  const k3 = cacheKey("joe", { a: 2 }, PROMPT_VERSION);
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.equal(k1, createHash("sha256").update(`joe|{"a":1}|${PROMPT_VERSION}`).digest("hex"));
});

test("validateVerdict: валидный вердикт проходит", () => {
  assert.doesNotThrow(() => validateVerdict(VERDICT));
});

test("validateVerdict: мусор → LlmError", () => {
  assert.throws(() => validateVerdict({ ...VERDICT, relevance: 5 }), /relevance/);
  assert.throws(() => validateVerdict({ ...VERDICT, category: "rockstar" }), /category/);
  assert.throws(() => validateVerdict({ ...VERDICT, dm_worth: "maybe" }), /dm_worth/);
  assert.throws(() => validateVerdict({ ...VERDICT, draft: "a{{name}}b" }), /placeholder/);
  assert.throws(() => validateVerdict({ ...VERDICT, draft: "" }), /draft/);
});

test("classifyLead: 1 вызов, вердикт применён, кэш работает (0 вызовов повторно)", async () => {
  const db = freshDb();
  db.prepare("INSERT INTO leads (id, handle) VALUES ('l1', 'artist_x')").run();
  const lead = db.prepare("SELECT * FROM leads WHERE id='l1'").get();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: "test-model", choices: [{ message: { content: JSON.stringify(VERDICT) } }], usage: { total_tokens: 100 } }),
    };
  };
  const beats = [{ name: "DARK TYPE BEAT", mood: "dark" }];
  const r1 = await classifyLead({ db, lead, facts: { note: "x" }, beats, env: { OPENROUTER_API_KEY: "test-key" }, fetchImpl });
  assert.equal(r1.cached, false);
  assert.equal(r1.verdict.dm_worth, "yes");
  assert.equal(calls, 1);
  const updated = applyVerdict(db, lead, r1.verdict, r1.model);
  assert.equal(updated.status, "ready");
  assert.equal(updated.dm_worth, 1);
  assert.match(updated.draft, /dark type beat/);

  const r2 = await classifyLead({ db, lead, facts: { note: "x" }, beats, env: { OPENROUTER_API_KEY: "test-key" }, fetchImpl });
  assert.equal(r2.cached, true);
  assert.equal(calls, 1); // кэш: 0 вызовов
});

test("classifyLead: вердикт no → rejected", async () => {
  const db = freshDb();
  db.prepare("INSERT INTO leads (id, handle) VALUES ('l2', 'artist_y')").run();
  const lead = db.prepare("SELECT * FROM leads WHERE id='l2'").get();
  const noVerdict = { ...VERDICT, dm_worth: "no" };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ model: "m", choices: [{ message: { content: JSON.stringify(noVerdict) } }] }) });
  const r = await classifyLead({ db, lead, facts: {}, env: { OPENROUTER_API_KEY: "test-key" }, fetchImpl });
  const updated = applyVerdict(db, lead, r.verdict, "m");
  assert.equal(updated.status, "rejected");
  assert.equal(updated.draft, null); // draft не пишем для rejected
});

test("classifyLead: transport fail → LlmError", async () => {
  const db = freshDb();
  db.prepare("INSERT INTO leads (id, handle) VALUES ('l3', 'artist_z')").run();
  const lead = db.prepare("SELECT * FROM leads WHERE id='l3'").get();
  await assert.rejects(
    classifyLead({ db, lead, facts: {}, fetchImpl: async () => { throw new Error("timeout"); } }),
    (e) => e.code === "LlmError"
  );
});

test("classifyLead: LLM вернул мусор → LlmError (fail-closed)", async () => {
  const db = freshDb();
  db.prepare("INSERT INTO leads (id, handle) VALUES ('l4', 'artist_w')").run();
  const lead = db.prepare("SELECT * FROM leads WHERE id='l4'").get();
  const fetchImpl = async () => ({ ok: true, json: async () => ({ model: "m", choices: [{ message: { content: "не json вообще" } }] }) });
  await assert.rejects(classifyLead({ db, lead, facts: {}, fetchImpl }), (e) => e.code === "LlmError");
});

test("llm_cache roundtrip", () => {
  const db = freshDb();
  putCached(db, "k", { a: 1 }, "m1");
  assert.equal(getCached(db, "k").a, 1);
  assert.equal(getCached(db, "missing"), null);
});

test("buildPrompt: JSON с лидом и каталогом", () => {
  const p = buildPrompt({ handle: "joe", artist: "Joe" }, { bio: "producer" }, [{ name: "DARK TYPE BEAT" }]);
  assert.ok(p.includes('"handle":"joe"'));
  assert.ok(p.includes("DARK TYPE BEAT"));
});
