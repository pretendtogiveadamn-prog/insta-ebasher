// Humanizer — insta-ebasher-v2 spec 01 §3.
// База: gmail-farm/engine/human.mjs (bezier-мышь, seeded RNG), typing-plan из
// beat-recovery human-interaction.ts (70-190ms/символ, паузы). Печать по настоящим
// keyboard-событиям (не insertText/paste). Перенос строки = Shift+Enter (Enter в
// IG-composer = SEND — TRAPS #1). IH_TIME_SCALE для тестов (0.1 = всё быстрее).
function makeRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function randFloat(rng, min, max) { return rng() * (max - min) + min; }
function chance(rng, p) { return rng() < p; }
function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

// Транскейл времени: IH_TIME_SCALE (масштаб, как YTBOT_TIME_SCALE). 0.1 = тесты.
export function timeScale() {
  const v = Number(process.env.IH_TIME_SCALE);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 10) : 1;
}
export function scaled(ms) {
  return Math.max(0, Math.round(ms * timeScale()));
}

// ── typingPlan (pure, unit-тестируется) — перенос из human-interaction.ts ─────
// Посимвольный план: 70-190ms базово, +40-120ms на пробел, +120-320ms на
// пунктуацию, редкие «думки» 300-900ms. "\n" помечен newline:true — актуатор
// отправит Shift+Enter, НЕ Enter (Enter в composer = send).
export function randomDelay(min, max, rng = Math.random) {
  if (max <= min) return Math.max(0, min);
  return min + Math.floor(rng() * (max - min + 1));
}

export function typingPlan(text, options = {}, rng = Math.random) {
  const minCharMs = options.minCharMs ?? 70;
  const maxCharMs = options.maxCharMs ?? 190;
  const pauseChance = options.pauseChance ?? 0.08;
  const pauseMinMs = options.pauseMinMs ?? 300;
  const pauseMaxMs = options.pauseMaxMs ?? 900;

  return Array.from(text).map((char) => {
    let delay = randomDelay(minCharMs, maxCharMs, rng);
    if (char === " ") delay += randomDelay(40, 120, rng);
    if (".,!?;:".includes(char)) delay += randomDelay(120, 320, rng);
    if (rng() < pauseChance) delay += randomDelay(pauseMinMs, pauseMaxMs, rng);
    const newline = char === "\n";
    return { char: newline ? "\n" : char, delay, newline };
  });
}

// bezierPath (pure) — перенос из human-interaction.ts: кривая с 2 jitter-контрольными.
export function bezierPath(from, to, steps = 24, rng = Math.random) {
  const safeSteps = Math.max(1, Math.floor(steps));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const spread = Math.hypot(dx, dy) * 0.25;
  const jitter = () => (rng() - 0.5) * 2 * spread;
  const c1 = { x: from.x + dx / 3 + jitter(), y: from.y + dy / 3 + jitter() };
  const c2 = { x: from.x + (2 * dx) / 3 + jitter(), y: from.y + (2 * dy) / 3 + jitter() };
  const points = [];
  for (let i = 0; i <= safeSteps; i++) {
    const t = i / safeSteps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x,
      y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y,
    });
  }
  return points;
}

// ── Page-актуаторы (Humanizer класс) ─────────────────────────────────────────
export class Humanizer {
  constructor({ seed = Date.now() >>> 0 } = {}) {
    this.rng = makeRng(seed);
    this.pos = { x: 250, y: 250 };
  }

  _ev() {} // evidence через jsonl logger снаружи; здесь пусто для совместимости

  async _step(ms) {
    await sleep(Math.max(0, Math.round(ms * timeScale())));
  }

  // bezier-движение к точке с ease-in-out + джиттер
  async moveTo(page, x, y, { hover = true } = {}) {
    const p0 = { ...this.pos };
    const p3 = { x, y };
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    if (dist < 3) { if (hover) await this._step(randInt(this.rng, 50, 300)); return; }
    const steps = Math.max(4, Math.min(30, Math.round(dist / 20)));
    for (let i = 1; i <= steps; i++) {
      const tRaw = i / steps;
      const t = tRaw < 0.5 ? 2 * tRaw * tRaw : 1 - Math.pow(-2 * tRaw + 2, 2) / 2;
      const jitter = i < steps ? randFloat(this.rng, -1.5, 1.5) : 0;
      await page.mouse.move(p0.x + (p3.x - p0.x) * t + jitter, p0.y + (p3.y - p0.y) * t + jitter);
      this.pos = { x: p0.x + (p3.x - p0.x) * t, y: p0.y + (p3.y - p0.y) * t };
      await this._step(randInt(this.rng, 20, 55));
    }
    if (hover) await this._step(randInt(this.rng, 80, 250)); // spec: hover 80-250ms до клика
  }

  async click(page, x, y) {
    await this.moveTo(page, x, y);
    await page.mouse.down();
    await this._step(randInt(this.rng, 60, 130));
    await page.mouse.up();
  }

  // клик по locator: случайная точка внутри бокса (30-70%)
  async clickSelector(page, selector, { timeoutMs = 10000 } = {}) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => {
      throw new Error(`human.clickSelector: элемент не виден: ${selector}`);
    });
    const box = await el.boundingBox();
    if (!box) throw new Error(`human.clickSelector: нет boundingBox у ${selector}`);
    await this.click(
      page,
      box.x + box.width * randFloat(this.rng, 0.3, 0.7),
      box.y + box.height * randFloat(this.rng, 0.3, 0.7)
    );
  }

  // клик по готовому боксу (свежие координаты): bezier к точке 30-70%
  async clickBox(page, b) {
    if (!b || !(b.w > 0) || !(b.h > 0)) return false;
    await this.click(page, b.x + b.w * randFloat(this.rng, 0.3, 0.7), b.y + b.h * randFloat(this.rng, 0.3, 0.7));
    return true;
  }

  // клик по кандидату deepQuery (box с момента сбора): bezier к точке 30-70% внутри бокса.
  // Возвращает false если box нет/нулевоей — вызывающий падает на css-фолбэк.
  async clickCandidate(page, c) {
    const b = c?.box;
    if (!b || !(b.w > 0) || !(b.h > 0)) return false;
    await this.click(
      page,
      b.x + b.w * randFloat(this.rng, 0.3, 0.7),
      b.y + b.h * randFloat(this.rng, 0.3, 0.7)
    );
    return true;
  }

  // лента: wheel-рывок вниз + пауза «чтения»; изредка — залип на пост (FEED_COOLDOWN, spec 08)
  async feedScroll(page) {
    await page.mouse.wheel(0, randInt(this.rng, 400, 900)).catch(() => {});
    await this._step(randInt(this.rng, 1500, 4000));
    if (this.rng() < 0.08) await this._step(randInt(this.rng, 8000, 15000)); // задержался на посте
  }

  // Печать по typingPlan: keyboard.type по символу; "\n" → Shift+Enter (TRAPS #1).
  // Контент уже в фокусе (composer кликнули через clickSelector) — печатаем сразу
  // в активный элемент, без el.fill()/insertText (телл детектора, TRAPS #2).
  async typeText(page, text) {
    await this._step(randInt(this.rng, 300, 900));
    for (const step of typingPlan(text, {}, this.rng)) {
      if (step.newline) {
        await page.keyboard.press("Shift+Enter");
      } else {
        // type (не press): ascii — keydown/keyup, эмодзи — per-char fallback (press падает на «👋», баг 2026-09-25)
        await page.keyboard.type(step.char);
      }
      await this._step(step.delay);
    }
  }

  // Прогулка по профилю/странице перед действием (dwell 3-8s spec)
  async dwell(page, { minMs = 3000, maxMs = 8000, scroll = true } = {}) {
    if (scroll && chance(this.rng, 0.7)) await this.scroll(page, { readingPause: false });
    await sleep(scaled(randInt(this.rng, minMs, maxMs)));
  }

  // Скролл: 2-5 штрихов
  async scroll(page, { readingPause = false } = {}) {
    const strokes = randInt(this.rng, 2, 5);
    for (let i = 0; i < strokes; i++) {
      await page.mouse.wheel(0, randInt(this.rng, 100, 400));
      await this._step(randInt(this.rng, 150, 500));
    }
    if (readingPause) await sleep(scaled(randInt(this.rng, 2000, 6000)));
  }

  // linger перед уходом 0.8-2.2s (spec 02 S9)
  async linger() {
    await sleep(scaled(randInt(this.rng, 800, 2200)));
  }

  async pause(minMs, maxMs) {
    await sleep(scaled(randInt(this.rng, minMs, maxMs)));
  }
}
