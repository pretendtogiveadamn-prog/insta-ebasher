// v1.mjs — HTTP-клиент бэкенда insta-ebasher v1 (lease-протокол, docs/04 v1).
// v1 = source of truth (CRM/квоты/кампании/DNC); v2 только исполняет outreach-lease:
// цель и текст выбирает v1, скрипт не угадывает получателя и не пишет сообщения.
export class V1Bridge {
  constructor({ baseUrl = process.env.IH_V1_URL || "", fetchImpl = fetch } = {}) {
    if (!baseUrl) throw new Error("v1 baseUrl пуст: передай --v1 <url> или IH_V1_URL");
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`v1 недоступен (${this.baseUrl}): ${e?.message ?? e}`);
    }
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {
        try {
          msg = `${res.status} ${(await res.text()).slice(0, 200)}`;
        } catch {}
      }
      const err = new Error(`v1 ${path}: ${msg}`);
      err.v1Message = msg;
      throw err;
    }
    return res.json();
  }

  getState() {
    return this.request("GET", "/api/agent/state");
  }

  heartbeat(accountId, chromeState, username = null) {
    return this.request("POST", "/api/agent/heartbeat", { accountId, chromeState, username });
  }

  accounts() {
    // отдельного GET /api/accounts в v1 нет — список приходит в snapshot
    return this.request("GET", "/api/panel/snapshot").then((s) => s.accounts ?? []);
  }

  createAccount(label) {
    return this.request("POST", "/api/accounts", { label });
  }

  // v1-аккаунт = «Chrome-агент» из их модели; у нас эту роль играет mailer-скрипт
  async ensureAccount(label) {
    const list = await this.accounts();
    const found = list.find((a) => a.label === label);
    if (found) return found;
    return this.createAccount(label);
  }

  takeOutreachLease(accountId) {
    return this.request("POST", "/api/agent/outreach-leases", { accountId });
  }

  postOutcome(leaseId, { outcome, observedHandle }) {
    return this.request("POST", `/api/agent/outreach-leases/${encodeURIComponent(leaseId)}/outcome`, {
      outcome,
      observedHandle,
    });
  }
}

// v2-код ошибки → v1 outcome. Whitelist v1: previewed|sent|not_sent|login_required|
// restricted|target_unavailable|uncertain|failed. uncertain = «не знаем, ушло ли» —
// v1 переведёт лид в unknown и не выдаст повторно (анти-дубль-DM).
export function outcomeForV1(code) {
  return (
    {
      RecipientResolutionError: "target_unavailable",
      DmRestrictedError: "restricted",
      SessionError: "login_required",
      ConfirmMissError: "uncertain",
      CaptchaError: "uncertain",
      ActionBlockError: "failed",
      ProxyError: "failed",
      TransientError: "failed",
      LlmError: "not_sent",
      SelectorMissError: "failed",
    }[code] ?? "failed"
  );
}

// «естественная» остановка: lease больше не выдаётся (нет лидов/кампании/квоты/активного lease)
export function isNaturalStop(err) {
  const msg = String(err?.v1Message ?? err?.message ?? "");
  return /no eligible lead|no running campaign|first-dm limit reached|active lease exists|chrome mcp is not ready/i.test(
    msg
  );
}
