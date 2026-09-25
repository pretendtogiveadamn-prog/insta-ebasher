import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTextMatches, isExactHandle, detectActionBlockText, isChallengeUrl, isAccountSuspendedUrl } from "../../src/flows/handle.mjs";

test("handleTextMatches: точное совпадение", () => {
  assert.equal(handleTextMatches("joe", "joe"), true);
  assert.equal(handleTextMatches("@joe", "joe"), true);
  assert.equal(handleTextMatches("JOE", "joe"), true);
});

test("handleTextMatches: подстроки НЕ совпадают (word-boundary)", () => {
  assert.equal(handleTextMatches("biglahaine", "lahaine"), false); // внутри имени
  assert.equal(handleTextMatches("@joey", "joe"), false); // справа продолжение
  assert.equal(handleTextMatches("xjoe", "joe"), false); // слева продолжение
  assert.equal(handleTextMatches("joe.b", "joe"), false);
});

test("handleTextMatches: границы вокруг handle-символов", () => {
  assert.equal(handleTextMatches("big joe_", "joe"), false); // _ = handle-char
  assert.equal(handleTextMatches("big joe smith", "joe"), true);
  assert.equal(handleTextMatches("big joe smith", "oe"), false);
});

test("handleTextMatches: edge-кейсы", () => {
  assert.equal(handleTextMatches("", "joe"), false);
  assert.equal(handleTextMatches("joe", ""), false);
  assert.equal(handleTextMatches("find @joe here", "joe"), true);
  assert.equal(handleTextMatches("reuelethan", "reuelethan"), true); // TRAPS #97: bare username
  assert.equal(handleTextMatches("рекомендация: @artist_official", "artist_official"), true);
});

test("isExactHandle: строгое побуквенное (нормировка только @ и trim)", () => {
  assert.equal(isExactHandle("@Joe_X", "joe_x"), true);
  assert.equal(isExactHandle("joe_x ", "joe_x"), true);
  assert.equal(isExactHandle("joe_x2", "joe_x"), false);
  assert.equal(isExactHandle(null, "joe_x"), false);
});

test("detectActionBlockText: паттерны 1.0 без too-broad /try again later/", () => {
  assert.equal(detectActionBlockText("You're temporarily blocked from performing this action"), "you'?re temporarily blocked");
  assert.ok(detectActionBlockText("Мы ограничили некоторые действия"));
  assert.equal(detectActionBlockText("Please try again later"), null); // too-broad не матчится
  assert.equal(detectActionBlockText("all good here"), null);
});

test("challenge/suspended URL детект", () => {
  assert.equal(isChallengeUrl("https://instagram.com/challenges/123/ok"), true);
  assert.equal(isChallengeUrl("https://instagram.com/joe/"), false);
  assert.equal(isAccountSuspendedUrl("https://instagram.com/accounts/suspended/"), true);
  assert.equal(isAccountSuspendedUrl("https://instagram.com/accounts/login/"), false);
});
