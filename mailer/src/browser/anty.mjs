// Anty panel client (127.0.0.1:3200) — spec 01 §1. Панель = owner Chrome.
// Бот только attach по CDP. Один writer на профиль.
export class AntyClient {
  constructor({ baseUrl = "http://127.0.0.1:3200", token = process.env.ANTY_TOKEN || "", fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("anty: unauthorized (нужен ANTY_TOKEN)");
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json())?.error ?? msg; } catch {}
      throw new Error(`anty ${method} ${path}: ${res.status} ${msg}`);
    }
    return res.json();
  }

  health() {
    return this.request("GET", "/api/health");
  }
  profiles() {
    return this.request("GET", "/api/profiles").then((r) => r.profiles ?? []);
  }
  profile(id) {
    return this.request("GET", `/api/profiles/${encodeURIComponent(id)}`);
  }
  open(id) {
    return this.request("POST", `/api/profiles/${encodeURIComponent(id)}/open`, {});
  }
  close(id) {
    return this.request("POST", `/api/profiles/${encodeURIComponent(id)}/close`, {});
  }
}

// CDP-порт жив? GET /json/version
export function cdpAlive(cdpPort, { timeoutMs = 2000, fetchImpl = fetch } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  return fetchImpl(`http://127.0.0.1:${cdpPort}/json/version`, { signal: ctl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

// Инвариант "один writer": attach разрешён если running+cdp жив; иначе open+poll.
// open ok:false (например proxy gate панели) → fail-closed. cdpAliveFn — инъекция для тестов.
export async function ensureAttachable(client, id, { waitMs = 30000, pollMs = 500, cdpAliveFn = cdpAlive } = {}) {
  const p = await client.profile(id);
  if (!p.running || !p.cdpPort) {
    const openRes = await client.open(id);
    if (openRes && openRes.ok === false) {
      const err = new Error(`anty open fail: ${openRes.error ?? openRes.reason ?? "unknown"}`);
      err.failClosed = true;
      throw err;
    }
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const cur = await client.profile(id).catch(() => null);
      if (cur?.running && cur?.cdpPort && (await cdpAliveFn(cur.cdpPort))) {
        return { profile: cur, openedByBot: true };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`anty: профиль ${id} не поднялся за ${waitMs}ms`);
  }
  if (!(await cdpAliveFn(p.cdpPort))) {
    throw new Error(`anty: панель говорит running, но CDP ${p.cdpPort} не отвечает`);
  }
  return { profile: p, openedByBot: false };
}
