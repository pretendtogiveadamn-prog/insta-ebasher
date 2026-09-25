import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSelfcheck } from "../../src/browser/selfcheck.mjs";

const goodSnap = {
  webdriver: false,
  inBrowserIp: "1.2.3.4",
  inBrowserGeo: "US",
  gateIp: "1.2.3.4",
  webrtcLocalCandidates: 0,
  userAgent: "Mozilla/5.0 ... Chrome/141.0.0.0 Safari/537.36",
  headlessUA: false,
  languages: ["en-US"],
  timezone: "America/New_York",
  expectedTimezone: "America/New_York",
  deviceFp: { canvasHash: "abc", webglRenderer: "ANGLE" },
  chromeRuntime: true,
  pluginsCount: 5,
  sannysoftShot: true,
};

test("selfcheck 7/7 на чистом снапшоте", () => {
  const v = evaluateSelfcheck(goodSnap, { baseline: goodSnap.deviceFp, chromeVersion: "141" });
  assert.equal(v.passed, 7);
  assert.equal(v.green, true);
});

test("selfcheck fail: webdriver=true", () => {
  const v = evaluateSelfcheck({ ...goodSnap, webdriver: true }, { baseline: goodSnap.deviceFp, chromeVersion: "141" });
  assert.equal(v.green, false);
});

test("selfcheck fail: IP в браузере ≠ gate IP (прокси мимо)", () => {
  const v = evaluateSelfcheck({ ...goodSnap, inBrowserIp: "9.9.9.9" }, { baseline: goodSnap.deviceFp, chromeVersion: "141" });
  assert.equal(v.results.find((r) => r.point === "ip_us_proxy").ok, false);
});

test("selfcheck first run: baseline записан, green", () => {
  const v = evaluateSelfcheck(goodSnap, { baseline: null, chromeVersion: "141" });
  assert.equal(v.green, true);
  assert.equal(v.firstRun, true);
});

test("selfcheck: canvas-дрейф = fail этого пункта (алерт), остальные green", () => {
  const v = evaluateSelfcheck(goodSnap, { baseline: { canvasHash: "different", webglRenderer: "ANGLE" }, chromeVersion: "141" });
  assert.equal(v.results.find((r) => r.point === "device_fp_baseline").ok, false);
  assert.equal(v.passed, 6);
});

test("selfcheck fail: fp-сбор не удался (fail-closed)", () => {
  const v = evaluateSelfcheck({ ...goodSnap, deviceFp: {} }, { baseline: goodSnap.deviceFp, chromeVersion: "141" });
  assert.equal(v.green, false);
});
