// Typed error catalog — insta-ebasher-v2 spec 00. Каждая ошибка несёт code/retriable/step/evidence.
export class TypedError extends Error {
  constructor(code, message, { step, evidencePath, leadId, accountId, probe, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = code;
    this.code = code;
    this.step = step ?? null;
    this.evidencePath = evidencePath ?? null;
    this.leadId = leadId ?? null;
    this.accountId = accountId ?? null;
    this.probe = probe ?? null;
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      step: this.step,
      evidencePath: this.evidencePath,
      leadId: this.leadId,
      accountId: this.accountId,
      probe: this.probe,
    };
  }
}

// spec 00 + 07: каталог кодов v2. ActionBlock/DmRestricted/ConfirmMiss/Captcha — НЕ retriable.
export const CATALOG = [
  "ProxyError",
  "SessionError",
  "RecipientResolutionError",
  "DmRestrictedError",
  "ActionBlockError",
  "ConfirmMissError",
  "CaptchaError",
  "LlmError",
  "SelectorMissError",
  "TransientError",
];

export const RETRYABLE = new Set(["ProxyError", "TransientError"]);

const byCode = {};
for (const code of CATALOG) {
  const cls = class extends TypedError {};
  Object.defineProperty(cls, "name", { value: code });
  byCode[code] = cls;
}

export function make(code, message, meta = {}) {
  const cls = byCode[code];
  if (!cls) throw new Error(`Unknown error code: ${code}`);
  return new cls(code, message, meta);
}

export function isRetriable(err) {
  return err instanceof TypedError && RETRYABLE.has(err.code);
}

export function fromUnknown(err, { code = "TransientError", ...meta } = {}) {
  if (err instanceof TypedError) return err;
  return make(code, err?.message ?? String(err), meta);
}
