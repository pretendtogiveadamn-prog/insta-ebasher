// Proxy fail-closed gate — spec 01 §4. Прокси живёт в Anty-профиле (панель сама
// держит upstream); бот НЕ дублирует прокси-слой, только проверяет его через probe
// (ip-api через локальный форвардер или напрямую через HTTP-прокси): geo = цель,
// latency < 2000ms. Кэш 6ч. Fail → ProxyError ДО attach.
// 1 аккаунт = 1 IP = одна сессия целиком; ротация mid-action запрещена.
import http from "node:http";
import { createProxyForwarder } from "./proxy_forwarder.mjs";
import { make } from "../core/errors.mjs";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000; // фейл не должен блокировать чиненный прокси на 6ч
const cache = new Map(); // proxyValue -> {result, at}

export function parseProxyValue(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (v.includes("://")) {
    const u = new URL(v);
    return {
      host: u.hostname,
      port: Number(u.port) || (u.protocol.startsWith("socks") ? 1080 : 80),
      username: u.username ? decodeURIComponent(u.username) : "",
      password: u.password ? decodeURIComponent(u.password) : "",
      socks: u.protocol.startsWith("socks"),
      scheme: u.protocol.replace(":", ""),
    };
  }
  // схема-less с кредами: u:p@host:port
  const m = /^(?:([^@:]+)(?::([^@]*))?@)?([^:@]+):(\d+)$/.exec(v);
  if (m) {
    return { host: m[3], port: Number(m[4]) || 80, username: m[1] || "", password: m[2] || "", socks: false, scheme: "http" };
  }
  const [host, port] = v.split(":");
  return { host, port: Number(port) || 80, username: "", password: "", socks: false, scheme: "http" };
}

function probeIpThroughForwarder({ proxy, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let fwd = null;
    const started = Date.now();
    const finish = (err, data) => {
      if (fwd) { try { fwd.close(); } catch {} }
      if (err) reject(err);
      else resolve({ ...data, latencyMs: Date.now() - started });
    };
    const fwdReady = proxy.username || proxy.password || proxy.socks
      ? createProxyForwarder({ host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password, socks: proxy.socks })
      : null;
    if (fwdReady) {
      fwd = fwdReady;
      fwdReady.ready.then((port) => doRequest(port)).catch((e) => finish(e));
    } else {
      // прокси без кредов: HTTP-прокси — абсолютный URI; SOCKS без кредов — не поддерживаем
      if (proxy.socks) return finish(new Error("socks5 proxy requires username/password"));
      doRequest(null);
    }

    function doRequest(localPort) {
      const req = http.request(
        {
          ...(localPort ? { host: "127.0.0.1", port: localPort } : { host: proxy.host, port: proxy.port }),
          path: "http://ip-api.com/json/?fields=status,message,country,countryCode,query",
          method: "GET",
          timeout: timeoutMs,
          headers: { "User-Agent": "insta-ebasher-v2" },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try { finish(null, JSON.parse(body)); } catch (e) { finish(e); }
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("probe timeout")));
      req.on("error", (e) => finish(e));
      req.end();
    }
  });
}

export async function proxyGate({
  proxyValue,
  requireCountry = "US",
  maxLatencyMs = 2000,
  timeoutMs = 2000,
  now = Date.now(),
  probeFn = probeIpThroughForwarder,
  useCache = true,
} = {}) {
  if (!proxyValue) {
    throw make("ProxyError", "прокси не задан (fail-closed: без подтверждённого прокси сессия не начинается)", { step: "gating" });
  }
  const key = String(proxyValue).trim();
  if (useCache) {
    const hit = cache.get(key);
    if (hit && now - hit.at < (hit.result.ok ? CACHE_TTL_MS : FAIL_TTL_MS)) {
      if (!hit.result.ok) throw make("ProxyError", `cached gate fail: ${hit.result.reason}`, { step: "gating", probe: hit.result });
      return hit.result;
    }
  }
  const proxy = parseProxyValue(key);
  let result;
  try {
    const probe = await probeFn({ proxy, timeoutMs });
    const country = probe.countryCode || null;
    const ok = probe.status === "success" && country === requireCountry && probe.latencyMs < maxLatencyMs;
    result = ok
      ? { ok: true, ip: probe.query, country, latencyMs: probe.latencyMs }
      : {
          ok: false,
          ip: probe.query ?? null,
          country,
          latencyMs: probe.latencyMs ?? null,
          reason:
            probe.status !== "success" ? "probe failed"
            : country !== requireCountry ? `geo=${country ?? "unknown"} ≠ ${requireCountry}`
            : `latency ${probe.latencyMs}ms ≥ ${maxLatencyMs}ms`,
        };
  } catch (e) {
    result = { ok: false, country: null, ip: null, latencyMs: null, reason: `probe error: ${e.message}` };
  }
  if (useCache) cache.set(key, { result, at: now });
  if (!result.ok) {
    throw make("ProxyError", `gate: ${result.reason}`, { step: "gating", probe: { country: result.country, ip: result.ip, latencyMs: result.latencyMs } });
  }
  return result;
}

export function clearGateCache() {
  cache.clear();
}
