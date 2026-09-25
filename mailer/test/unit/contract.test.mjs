import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContract, validateContract, loadAllZones, liveGateOk, contractStatuses } from "../../src/core/contract.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("все IG-зоны парсятся и проходят валидацию", () => {
  const zones = loadAllZones(ROOT);
  const names = zones.map((z) => z.zone);
  for (const z of ["profile", "thread", "send-confirm", "action-block", "captcha", "login"]) {
    assert.ok(names.includes(z), z);
  }
  for (const z of zones) {
    assert.ok(z.elements.length > 0, z.zone);
  }
});

test("verified-элементы валидны (at+evidence обязательны)", () => {
  // после live-аудита 2026-09-25 часть элементов verified — это норма; инвариант: verified всегда с evidence
  const zones = loadAllZones(ROOT);
  for (const z of zones) {
    for (const el of z.elements) {
      if ((el.verified?.status ?? "pending") === "verified") {
        assert.ok(el.verified.at && el.verified.evidence, `${z.zone}/${el.label}: verified без at/evidence`);
      }
    }
  }
});

test("live-gate: pending блокирует live, dry-run разрешён", () => {
  const zones = loadAllZones(ROOT);
  const gate = liveGateOk(zones);
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.length > 0);
  // после пометки всех verified — gate ok
  for (const z of zones) for (const el of z.elements) el.verified = { status: "verified", at: "2026-01-01", evidence: "e/" };
  assert.equal(liveGateOk(zones).ok, true);
});

test("contractStatuses", () => {
  const zones = loadAllZones(ROOT);
  const st = contractStatuses(zones);
  assert.ok(["pending", "verified"].includes(st.profile.profile_message_button));
});

test("валидация ловит мусор", () => {
  assert.throws(() => parseContract("elements: []", "z"), /version|elements/);
  assert.throws(() => parseContract("version: 1\nelements:\n  - label: a\n    role: nope\n    strategies: []", "z"), /role/);
  assert.throws(() => parseContract("version: 1\nelements:\n  - label: a\n    role: trigger\n    strategies:\n      - t: css\n        v: 'x:has-text(y)'", "z"), /запрещён/);
  assert.throws(
    () => parseContract("version: 1\nelements:\n  - label: a\n    role: trigger\n    strategies:\n      - t: text\n        v: hi\n    verified:\n      status: verified", "z"),
    /at \+ evidence/
  );
});
