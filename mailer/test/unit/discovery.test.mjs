// discovery.mjs — регрессионные тесты само-хилинга.
// Главный риск (баг 2026-09-24): правила писались под НЕСУЩЕСТВУЮЩУЮ форму кандидатов
// (c.attrs.*, "H1") и молча не работали. Здесь — фиксация flat-формы deepQuery + анти-фолс-позитив.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISCOVERY_RULES, suggestStrategy, validateSuggestion, recordDiscovery, discoveryAllowed } from "../../src/core/discovery.mjs";
import { ROOT } from "../../src/core/paths.mjs";

// flat-кандидат deepQuery (src/core/dom.mjs): tag lowercase, ariaLabel/placeholder/href/name/role top-level
const base = {
  visible: true,
  disabled: false,
  ancestors: ["div", "main"],
  hostChain: [],
  classes: [],
  text: "",
  ariaLabel: null,
  placeholder: null,
  href: null,
  name: null,
  role: null,
  tag: "div",
  id: null,
  box: { x: 10, y: 10, w: 100, h: 30 },
};

test("discovery rules: flat-форма кандидатов (регрессия 2026-09-24 — правила были мёртвы)", () => {
  assert.ok(DISCOVERY_RULES["thread/composer"]([{ ...base, role: "textbox" }]));
  assert.ok(DISCOVERY_RULES["profile/header_username"]([{ ...base, tag: "h1", text: "deezzo_prod3" }]));
  assert.ok(DISCOVERY_RULES["direct-new/search_input"]([{ ...base, tag: "input", name: "searchInput" }]));
  assert.ok(DISCOVERY_RULES["login/nav_own_profile_link"]([{ ...base, tag: "a", href: "/direct/inbox/" }]));
  assert.ok(DISCOVERY_RULES["send-confirm/sent_status_icon"]([{ ...base, tag: "svg", ariaLabel: "Sent" }]));
  assert.ok(DISCOVERY_RULES["profile/profile_message_button"]([{ ...base, role: "button", text: "Message" }]));
});

test("discovery rules: анти-фолс-позитив — «Messages» топ-бара ≠ кнопка Message", () => {
  const topBar = { ...base, tag: "a", role: "link", text: "Messages", href: "/direct/inbox/" };
  assert.equal(DISCOVERY_RULES["profile/profile_message_button"]([topBar]), null);
  // и button с текстом "Messages" (мн.ч.) — тоже не кнопка Message
  const plural = { ...base, role: "button", text: "Messages" };
  assert.equal(DISCOVERY_RULES["profile/profile_message_button"]([plural]), null);
});

test("discovery rules: unique-гард — 2+ сильных матча → null (лучше miss, чем клик не туда)", () => {
  const two = [{ ...base, role: "textbox" }, { ...base, role: "textbox" }];
  assert.equal(DISCOVERY_RULES["thread/composer"](two), null);
  const one = [{ ...base, role: "textbox" }, { ...base, role: "button", text: "x" }];
  assert.ok(DISCOVERY_RULES["thread/composer"](one));
});

test("discovery rules: невидимые/disabled кандидаты не хилят", () => {
  assert.equal(DISCOVERY_RULES["thread/composer"]([{ ...base, role: "textbox", visible: false }]), null);
  assert.equal(DISCOVERY_RULES["thread/composer"]([{ ...base, role: "textbox", disabled: true }]), null);
});

test("suggestStrategy: стабильные признаки, не классы-жетоны", () => {
  assert.deepEqual(suggestStrategy({ ...base, tag: "input", name: "searchInput" }), { t: "css", v: "input[name='searchInput']" });
  assert.deepEqual(suggestStrategy({ ...base, tag: "svg", ariaLabel: "Sent" }), { t: "css", v: "svg[aria-label='Sent']" });
  assert.deepEqual(suggestStrategy({ ...base, tag: "div", role: "textbox" }), { t: "css", v: "div[role='textbox']" });
  assert.deepEqual(suggestStrategy({ ...base, tag: "input", placeholder: "Search…" }), { t: "css", v: "input[placeholder*='Search…']" });
  assert.deepEqual(suggestStrategy({ ...base, tag: "div" }), { t: "css", v: "div" });
});

test("validateSuggestion: стратегия re-resolve находит ТОГО ЖЕ победителя (self-check)", () => {
  const winner = { ...base, role: "textbox" };
  const others = [{ ...base, role: "button", text: "x" }];
  const strategy = suggestStrategy(winner); // div[role='textbox']
  assert.equal(validateSuggestion(strategy, [winner, ...others], winner), true);
  // чужой элемент той же стратегией не валиден
  const other = { ...base, role: "button" };
  assert.equal(validateSuggestion(strategy, [winner, other], other), false);
  // битая стратегия → false, не throw
  assert.equal(validateSuggestion({ t: "css", v: "???" }, [winner], winner), false);
});

test("recordDiscovery: дописывает pending-стратегию, idempotent, state-элементы не трогает", () => {
  const dir = mkdtempSync(join(tmpdir(), "ih-disc-"));
  mkdirSync(join(dir, "contracts"), { recursive: true });
  writeFileSync(
    join(dir, "contracts", "thread.yaml"),
    `version: 1
elements:
  - label: composer
    role: field
    strategies:
      - t: css
        v: "div[role='textbox']"
  - label: network_send_ok
    role: state
    allowDiscovery: false
    strategies:
      - t: text
        v: "__NETWORK_OK__"
`
  );
  const ok = recordDiscovery(dir, "thread", "composer", { t: "css", v: "div[contenteditable='true']" }, "test");
  assert.equal(ok, true);
  const after = readFileSync(join(dir, "contracts", "thread.yaml"), "utf8");
  assert.match(after, /contenteditable/);
  // idempotent: дубль не пишется
  assert.equal(recordDiscovery(dir, "thread", "composer", { t: "css", v: "div[contenteditable='true']" }), false);
  // state/allowDiscovery:false — отказ (анти-самообман)
  assert.equal(recordDiscovery(dir, "thread", "network_send_ok", { t: "css", v: "div" }), false);
});

test("discoveryAllowed: state и allowDiscovery:false — хилинг запрещён", () => {
  assert.equal(discoveryAllowed(ROOT, "thread", "composer"), true);
  assert.equal(discoveryAllowed(ROOT, "send-confirm", "network_send_ok"), false); // state
  assert.equal(discoveryAllowed(ROOT, "captcha", "challenge_page"), false); // state + allowDiscovery:false
  assert.equal(discoveryAllowed(ROOT, "direct-new", "result_row"), true); // правила нет — null, но флаг не запрещает
  assert.equal(discoveryAllowed(ROOT, "nope", "nope"), false); // нет зоны → fail-closed
});
