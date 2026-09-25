import { test } from "node:test";
import assert from "node:assert/strict";
import { typingPlan, bezierPath, scaled, Humanizer } from "../../src/browser/human.mjs";

test("typingPlan: длительности в рамках дефолтов 70-190 + надбавки", () => {
  const rng = () => 0.99; // максимум: база 190, пробел +120, пунктуация +320, думка +900
  const plan = typingPlan("Hi. Ok", {}, rng);
  // rng=0.99 → pauseChance срабатывает
  for (const s of plan) {
    assert.ok(s.delay >= 70, `delay=${s.delay}`);
    assert.ok(s.delay <= 190 + 120 + 320 + 900, `delay=${s.delay}`);
  }
});

test("typingPlan: пробел и пунктуация дольше базового", () => {
  const plan = typingPlan("a b.", {}, () => 0);
  // rng=0: база 70, пробел +40, '.' +120; думка +300 на каждом (rng=0 < 0.08) —
  // относительный порядок сохраняется: пробел и точка > соседей
  const [a, space, b, dot] = plan;
  assert.ok(space.delay > a.delay, `${space.delay} > ${a.delay}`);
  assert.ok(dot.delay > b.delay, `${dot.delay} > ${b.delay}`);
});

test("typingPlan: newline помечен (Shift+Enter, не Enter)", () => {
  const plan = typingPlan("line1\nline2", {}, () => 0);
  const nl = plan.find((s) => s.newline);
  assert.ok(nl, "newline-шаг есть");
  assert.equal(nl.char, "\n");
});

test("typingPlan: не один bulk-insert — по символу", () => {
  const plan = typingPlan("привет мир", {}, () => 0);
  assert.equal(plan.length, 10);
});

test("bezierPath: начало/конец на цели, монотонный шаг", () => {
  const pts = bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 }, 20, () => 0.5);
  assert.equal(pts.length, 21);
  assert.deepEqual({ x: Math.round(pts[0].x), y: Math.round(pts[0].y) }, { x: 0, y: 0 });
  assert.ok(Math.abs(pts[20].x - 100) < 1e-6 && Math.abs(pts[20].y - 50) < 1e-6);
  const dxs = pts.slice(1).map((p, i) => p.x - pts[i].x);
  assert.ok(dxs.every((d) => d >= -1e-6), "x монотонно растёт при rng=0.5");
});

test("scaled: IH_TIME_SCALE", () => {
  const prev = process.env.IH_TIME_SCALE;
  process.env.IH_TIME_SCALE = "0.1";
  assert.equal(scaled(1000), 100);
  process.env.IH_TIME_SCALE = "1";
  assert.equal(scaled(1000), 1000);
  if (prev === undefined) delete process.env.IH_TIME_SCALE;
  else process.env.IH_TIME_SCALE = prev;
});
