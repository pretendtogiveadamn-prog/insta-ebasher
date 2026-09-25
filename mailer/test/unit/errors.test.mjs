import { test } from "node:test";
import assert from "node:assert/strict";
import { make, isRetriable, fromUnknown, CATALOG, TypedError } from "../../src/core/errors.mjs";

test("каталог кодов v2 полный", () => {
  for (const code of ["ProxyError", "SessionError", "RecipientResolutionError", "DmRestrictedError", "ActionBlockError", "ConfirmMissError", "CaptchaError", "LlmError"]) {
    assert.ok(CATALOG.includes(code), code);
    const e = make(code, "msg", { step: "S1", leadId: "l1" });
    assert.ok(e instanceof TypedError);
    assert.equal(e.code, code);
    assert.equal(e.step, "S1");
    assert.equal(e.leadId, "l1");
  }
});

test("retriable только Proxy/Transient", () => {
  assert.ok(isRetriable(make("ProxyError", "x")));
  assert.ok(isRetriable(make("TransientError", "x")));
  assert.equal(isRetriable(make("ActionBlockError", "x")), false);
  assert.equal(isRetriable(make("ConfirmMissError", "x")), false);
  assert.equal(isRetriable(make("DmRestrictedError", "x")), false);
  assert.equal(isRetriable(new Error("plain")), false);
});

test("unknown error код — ошибка генератора", () => {
  assert.throws(() => make("NoSuch", "x"));
});

test("fromUnknown оборачивает и пропускает typed", () => {
  const typed = make("CaptchaError", "x");
  assert.equal(fromUnknown(typed), typed);
  const wrapped = fromUnknown(new Error("boom"), { code: "SessionError", step: "S5" });
  assert.equal(wrapped.code, "SessionError");
  assert.equal(wrapped.step, "S5");
  assert.match(wrapped.message, /boom/);
});
