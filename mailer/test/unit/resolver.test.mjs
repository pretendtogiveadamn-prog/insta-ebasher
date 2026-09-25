import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSimpleSelector, matchStrategy, resolveCandidates, disambiguate } from "../../src/core/resolver.mjs";

const cand = (o = {}) => ({
  tag: "div",
  id: null,
  classes: [],
  ariaLabel: null,
  text: "",
  visible: true,
  disabled: false,
  role: null,
  ancestors: [],
  ...o,
});

test("parseSimpleSelector: сегменты/атрибуты", () => {
  const p = parseSimpleSelector("div[role='textbox']");
  assert.deepEqual({ tag: p.segments[0].tag, attr: p.segments[0].attrs[0].attr, val: p.segments[0].attrs[0].val }, { tag: "div", attr: "role", val: "textbox" });
  assert.equal(parseSimpleSelector("a b c").segments.length, 3);
  assert.equal(parseSimpleSelector("div + span"), null); // sibling live-only
});

test("matchStrategy css: role-атрибут матч", () => {
  const s = { t: "css", v: "div[role='textbox']" };
  const hit = [cand({ role: "textbox" }), cand({ role: "button" })];
  const m = matchStrategy(s, hit);
  assert.equal(m.length, 1);
  assert.equal(m[0].role, "textbox");
});

test("matchStrategy text: variants exact/includes", () => {
  const exact = { t: "text", v: "Message" };
  assert.equal(matchStrategy(exact, [cand({ text: "Message" }), cand({ text: "Message threads" })]).length, 1);
  const inc = { t: "text", v: "blocked", match: "includes" };
  assert.equal(matchStrategy(inc, [cand({ text: "You're temporarily blocked" })]).length, 1);
  assert.equal(matchStrategy(inc, [cand({ text: "fine" })]).length, 0);
});

test("resolveCandidates: одиночный viable = winner", () => {
  const el = { label: "btn", role: "trigger", strategies: [{ t: "text", v: "Message" }] };
  const r = resolveCandidates(el, [cand({ text: "Message" }), cand({ text: "Follow" })]);
  assert.equal(r.winner.text, "Message");
});

test("resolveCandidates: несколько viable без disambig → first_visible", () => {
  const el = { label: "btn", role: "trigger", strategies: [{ t: "text", v: "Message", match: "includes" }] };
  const r = resolveCandidates(el, [cand({ text: "Message X" }), cand({ text: "Message Y" })]);
  assert.ok(r.winner); // first_visible
});

test("resolveCandidates: miss → misses=1", () => {
  const el = { label: "btn", role: "trigger", strategies: [{ t: "text", v: "Message" }] };
  const r = resolveCandidates(el, [cand({ text: "Follow" })]);
  assert.equal(r.winner, null);
  assert.equal(r.misses, 1);
});

test("disambiguate: invisible/disabled отфильтрованы", () => {
  const out = disambiguate([cand({ text: "a", visible: false }), cand({ text: "b" })]);
  assert.equal(out.text, "b");
  const none = disambiguate([cand({ disabled: true })]);
  assert.equal(none, null);
});
