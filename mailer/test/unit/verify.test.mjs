import { test } from "node:test";
import assert from "node:assert/strict";
import { domConfirmMatches, confirmSent } from "../../src/flows/verify.mjs";
import { withFakeDom } from "./helpers/fake-dom.mjs";
import { collectThreadData } from "../../src/flows/verify.mjs";

test("domConfirmMatches: текст в треде + composer пуст = ok (иконка не обязательна)", () => {
  const r = domConfirmMatches({ threadText: "превью... hey check this beat out ...", statusIcons: ["Sent"], inComposer: false }, "hey check this beat out");
  assert.equal(r.ok, true);
});

test("domConfirmMatches: переносы строк в пузыре не ломают матч", () => {
  const r = domConfirmMatches(
    { threadText: "hey @someone 👋 came across\nyour page — your sound\nis clean", statusIcons: [], inComposer: false },
    "hey @someone 👋 came across your page — your sound is clean"
  );
  assert.equal(r.ok, true);
});

test("domConfirmMatches: текст есть, иконки нет → ok (мини-чат без Sent-иконки)", () => {
  const r = domConfirmMatches({ threadText: "hey beat", statusIcons: [], inComposer: false }, "hey beat");
  assert.equal(r.ok, true);
});

test("domConfirmMatches: эмодзи как <img> (нет в innerText) не ломает матч", () => {
  const r = domConfirmMatches(
    { threadText: "Hey @deezzo_prod  came across your page — your sound is clean. I make type beats, got a couple fresh ones", statusIcons: [], inComposer: false },
    "Hey @deezzo_prod 👋 came across your page — your sound is clean. I make type beats, got a couple fresh ones"
  );
  assert.equal(r.ok, true);
});

test("domConfirmMatches: текст ещё в composer → НЕ ok (Enter не прошёл)", () => {
  const r = domConfirmMatches({ threadText: "hey beat", statusIcons: [], inComposer: true }, "hey beat");
  assert.equal(r.ok, false);
  assert.match(r.reason, /composer/);
});

test("domConfirmMatches: текста нет → не ok", () => {
  assert.equal(domConfirmMatches({ threadText: "другое", statusIcons: ["Sent"] }, "hey beat").ok, false);
});

test("collectThreadData собирает текст и aria-label'ы (через fake-dom)", async () => {
  const data = await withFakeDom(
    { bodyText: "msg body here hey beat", statusIcons: ["Sent", "Delivered"] },
    async (arg) => collectThreadData({ evaluate: (fn) => fn(arg) }, "hey beat")
  );
  assert.equal(data.threadText.includes("hey beat"), true);
  assert.deepEqual(data.statusIcons, ["Sent", "Delivered"]);
});

test("confirmSent: network ok → success без DOM", async () => {
  const page = { evaluate: async () => ({ threadText: "", statusIcons: [] }) };
  const net = { state: { ok: true, detail: { url: "x" } } };
  const r = await confirmSent({ page, draftText: "hey", netConfirm: net, timeoutMs: 500, sleepFn: async () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.via, "network");
});

test("confirmSent: DOM подтверждение позже (2-й опрос)", async () => {
  let call = 0;
  const page = {
    evaluate: async () => {
      call++;
      return call >= 2 ? { threadText: "draft here", statusIcons: ["Delivered"] } : { threadText: "пусто", statusIcons: [] };
    },
  };
  const r = await confirmSent({ page, draftText: "draft here", netConfirm: { state: { ok: false } }, timeoutMs: 3000, sleepFn: async () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.via, "dom");
});

test("confirmSent: ни DOM ни network → ConfirmMissError", async () => {
  const page = { evaluate: async () => ({ threadText: "пусто", statusIcons: [] }) };
  await assert.rejects(
    confirmSent({ page, draftText: "draft", netConfirm: { state: { ok: false } }, timeoutMs: 300, sleepFn: async () => {} }),
    (e) => e.code === "ConfirmMissError"
  );
});

test("confirmSent: кнопка нажата ≠ success — composer очистился тоже ≠ success", () => {
  // «composer пуст» без текста в ленте = confirm_miss (главный урок 1.0)
  const r = domConfirmMatches({ threadText: "", statusIcons: ["Sent"] }, "hey");
  assert.equal(r.ok, false);
});
