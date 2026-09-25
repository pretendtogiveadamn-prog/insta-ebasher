import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyGate, clearGateCache, parseProxyValue } from "../../src/browser/gate.mjs";

test("parseProxyValue: схема-less с кредами и URL-форма", () => {
  const p1 = parseProxyValue("user:pass@1.2.3.4:8080");
  assert.deepEqual({ host: p1.host, port: p1.port, username: p1.username, password: p1.password }, { host: "1.2.3.4", port: 8080, username: "user", password: "pass" });
  const p2 = parseProxyValue("socks5://u:p@1.2.3.4:1080");
  assert.equal(p2.socks, true);
  assert.equal(p2.port, 1080);
  const p3 = parseProxyValue("5.6.7.8:9000");
  assert.equal(p3.username, "");
});

test("gate: fail-closed при отсутствии прокси", async () => {
  await assert.rejects(proxyGate({ proxyValue: null }), /прокси не задан/);
});

test("gate: geo mismatch → ProxyError", async () => {
  clearGateCache();
  const probeFn = async () => ({ status: "success", countryCode: "DE", query: "5.5.5.5", latencyMs: 100 });
  await assert.rejects(proxyGate({ proxyValue: "5.5.5.5:8080", probeFn, useCache: false }), /geo=DE/);
});

test("gate: latency выше порога → ProxyError", async () => {
  clearGateCache();
  const probeFn = async () => ({ status: "success", countryCode: "US", query: "5.5.5.5", latencyMs: 3000 });
  await assert.rejects(proxyGate({ proxyValue: "5.5.5.5:8080", probeFn, useCache: false }), /latency/);
});

test("gate: probe error → ProxyError", async () => {
  clearGateCache();
  await assert.rejects(proxyGate({ proxyValue: "5.5.5.5:8080", probeFn: async () => { throw new Error("timeout"); }, useCache: false }), /probe error/);
});

test("gate: ok + кэш 6ч", async () => {
  clearGateCache();
  let calls = 0;
  const probeFn = async () => {
    calls++;
    return { status: "success", countryCode: "US", query: "5.5.5.5", latencyMs: 300 };
  };
  const r1 = await proxyGate({ proxyValue: "5.5.5.5:8080", probeFn });
  const r2 = await proxyGate({ proxyValue: "5.5.5.5:8080", probeFn });
  assert.equal(r1.ok, true);
  assert.equal(r2.ip, "5.5.5.5");
  assert.equal(calls, 1);
});
