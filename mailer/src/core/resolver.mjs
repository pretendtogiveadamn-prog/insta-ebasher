// resolver.mjs — контракт → элемент. Стратегии spec 01 §2, file-скоринг §4, discovery §6.
// Работает с сериализуемыми кандидатами (dom.deepQuery) — офлайн-тестируемо.
import { make } from "./errors.mjs";

// ── file-скоринг (spec 01 §4, перенос STUDIO_DOM) ──
export function scoreFileCandidate(c) {
  let s = 0;
  if ((c.accept ?? "").includes("video")) s += 4;
  if (c.name === "Filedata") s += 3;
  if (ancestorStartsWith(c, "ytcp-uploads-")) s += 5;
  if (ancestorStartsWith(c, "ytcp-thumbnail-")) s -= 10;
  if (ancestorStartsWith(c, "ytcp-channel-picture-edit")) s -= 10;
  return s;
}

function ancestorStartsWith(c, prefix) {
  const tags = [...(c.ancestors ?? []), ...((c.hostChain ?? []).map((h) => String(h).toLowerCase()))];
  return tags.some((t) => t.startsWith(prefix.toLowerCase()));
}

export function pickFileInput(candidates) {
  const best = candidates.map((c) => ({ c, s: scoreFileCandidate(c) })).filter((x) => x.s > 0);
  if (!best.length) return null;
  const max = Math.max(...best.map((b) => b.s));
  const top = best.filter((b) => b.s === max);
  return top.length === 1 ? top[0].c : null;
}

// ── mini CSS-парсер: [комбинаторные пути] tag#id.class[attr op=v i] (descendant, child >) ──
export function parseSimpleSelector(sel) {
  const s = String(sel).trim();
  if (!s) return null;
  if (/[+~]/.test(s)) return null; // sibling-селекторы офлайн не матчатся (live-only)
  if (s.includes(" ") || s.includes(">")) return parseChain(s);
  const one = parseSegment(s);
  return one ? { segments: [one], combinators: [] } : null;
}

function parseChain(s) {
  const parts = splitTop(s);
  const segments = [];
  const combinators = [];
  for (let i = 0; i < parts.length; i++) {
    const [comb, chunk] = parts[i];
    if (i > 0) combinators.push(comb);
    const seg = parseSegment(chunk);
    if (!seg) throw new Error(`unparseable segment: ${chunk}`);
    segments.push(seg);
  }
  if (!segments.length) return null;
  return { segments, combinators };
}

// split по пробелам/>  ВНЕ скобок-значений (пробелы внутри [attr*='...'] не режутся)
function splitTop(s) {
  const out = [];
  let cur = "", depth = 0, quote = null, pendingChild = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "[") { depth++; cur += ch; continue; }
    if (ch === "]") { depth = Math.max(0, depth - 1); cur += ch; continue; }
    if (depth > 0) { cur += ch; continue; }
    if (ch === "+" || ch === "~") throw new Error("sibling selector — live-only");
    if (ch === ">") { pendingChild = true; continue; }
    if (ch === " ") {
      if (cur) out.push([pendingChild ? "child" : "descendant", cur]);
      cur = "";
      pendingChild = false;
      continue;
    }
    cur += ch;
  }
  if (cur) out.push([pendingChild ? "child" : "descendant", cur]);
  return out;
}

export function parseSegment(seg) {
  const m = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/.exec(seg.trim());
  if (!m) return null;
  const [, tag, idClasses, attrsPart] = m;
  let id = null;
  const classes = [];
  for (const mm of String(idClasses ?? "").matchAll(/([.#])([\w-]+)/g)) {
    if (mm[1] === "#") id = mm[2]; else classes.push(mm[2]);
  }
  const attrs = [];
  const re = /\[([a-zA-Z-]+)([*^$]?=)?([^\]]*)\]/g;
  let mm2;
  while ((mm2 = re.exec(attrsPart ?? ""))) {
    let val = mm2[3] ?? "";
    let ci = false;
    if (/ i$/.test(val)) { ci = true; val = val.slice(0, -2); }
    val = val.replace(/^['"]|['"]$/g, "");
    attrs.push({ attr: mm2[1], op: mm2[2] ?? null, val, i: ci });
  }
  if (!tag && !id && !classes.length && attrs.length === 0) return null;
  return { tag: tag && tag !== "*" ? tag.toLowerCase() : null, id, classes, attrs };
}

function matchSegment(c, seg) {
  if (seg.tag && !c.tag.startsWith(seg.tag)) return false;
  if (seg.id && c.id !== seg.id) return false;
  for (const cl of seg.classes) {
    if (!(c.classes ?? []).includes(cl)) return false;
  }
  for (const { attr, op, val, i } of seg.attrs) {
    const actual =
      attr === "test-id"
        ? c.testId
        : attr === "aria-label"
          ? c.ariaLabel
          : attr === "name"
            ? c.name
            : attr === "type"
              ? c.type
              : attr === "accept"
                ? c.accept
                : attr === "role"
                  ? c.role
                  : attr === "href"
                    ? c.href
                    : attr === "placeholder"
                      ? c.placeholder
                      : null;
    if (actual === null || actual === undefined) return false;
    if (!op) { if (!String(actual)) return false; continue; }
    const a = i ? String(actual).toLowerCase() : String(actual);
    const b = i ? String(val).toLowerCase() : String(val);
    if (op === "=" && a !== b) return false;
    if (op === "*=" && !a.includes(b)) return false;
    if (op === "^=" && !a.startsWith(b)) return false;
    if (op === "$=" && !a.endsWith(b)) return false;
  }
  return true;
}

function candidateMatchesSelector(c, parsed) {
  // последний сегмент — сам кандидат; предшествующие — по ancestors (ближайший — индекс 0).
  // ancestors офлайн = tag-строки (глубина до 30, deepQuery); точная проверка атрибутов предков — live.
  const { segments, combinators } = parsed;
  if (!matchSegment(c, segments[segments.length - 1])) return false;
  if (segments.length === 1) return true;
  const ancList = c.ancestors ?? [];
  let ai = 0;
  for (let s = segments.length - 2; s >= 0; s--) {
    const comb = combinators[s] ?? "descendant";
    if (comb === "child") {
      if (ai >= ancList.length || !ancMatches(ancList[ai], segments[s])) return false;
      ai++;
    } else {
      let found = -1;
      for (let k = ai; k < ancList.length; k++) {
        if (ancMatches(ancList[k], segments[s])) { found = k; break; }
      }
      if (found === -1) return false;
      ai = found + 1;
    }
  }
  return true;
}

function ancMatches(tag, seg) {
  return seg.tag ? String(tag).startsWith(seg.tag) : Boolean(tag);
}

function strategyMatches(s, c) {
  const parsed = parseSimpleSelector(s.v);
  if (!parsed) return false;
  return candidateMatchesSelector(c, parsed);
}

// ── disambig ──
export function disambiguate(candidates, disambig = "first_visible") {
  const visible = candidates.filter((c) => c.visible && !c.disabled);
  if (!visible.length) return null;
  const [kind, arg] = String(disambig).split(":");
  switch (kind) {
    case "first_visible": return visible[0];
    case "last_visible": return visible[visible.length - 1];
    case "nth": {
      const n = Number(arg);
      return Number.isInteger(n) ? (visible[n] ?? null) : null;
    }
    case "closest": return null; // live-дом близость — только live-аудит
    default: return visible[0];
  }
}

// матч одной стратегии по кандидатам
export function matchStrategy(strategy, candidates) {
  const t = strategy.t;
  if (t === "file") {
    const picked = pickFileInput(candidates);
    return picked ? [picked] : [];
  }
  if (t === "css" || t === "shadow" || t === "attr") {
    const vis = candidates.filter((c) => c.visible && !c.disabled);
    return vis.filter((c) => strategyMatches(strategy, c));
  }
  if (t === "text") {
    const variants = (Array.isArray(strategy.v) ? strategy.v : [strategy.v]).map(String);
    const match = strategy.match ?? "exact";
    const vis = candidates.filter((c) => c.visible && !c.disabled);
    return vis.filter((c) => {
      if (strategy.scope) {
        const tags = scopeTagList(strategy.scope);
        if (!(c.ancestors ?? []).some((a) => tags.some((st) => a.startsWith(st)))) return false;
      }
      const fields = [c.text ?? "", c.ariaLabel ?? ""];
      return variants.some((v) =>
        fields.some((f) =>
          match === "exact" ? f === v : match === "prefix" ? f.startsWith(v) : f.includes(v)
        )
      );
    });
  }
  return []; // xpath — live-only
}

function scopeTagList(scope) {
  return String(scope)
    .split(/[\s,>+]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase().replace(/[#.\[].*$/, ""));
}

// ── главный резолв ──
export function resolveCandidates(contractElement, candidates) {
  const results = { winner: null, byStrategy: [], losses: 0, misses: 0 };
  if (contractElement.role === "file_input") {
    const picked = pickFileInput(candidates);
    if (!picked) { results.misses = 1; return results; }
    results.winner = picked;
    results.byStrategy.push({ index: 0, type: "file", won: true });
    return results;
  }
  for (let i = 0; i < contractElement.strategies.length; i++) {
    const s = contractElement.strategies[i];
    let matched = [];
    try { matched = matchStrategy(s, candidates); } catch { matched = []; }
    const viable = matched.filter((c) => c.visible && !c.disabled);
    if (viable.length === 1) {
      results.winner = viable[0];
      results.byStrategy.push({ index: i, type: s.t, won: true });
      return results;
    }
    if (viable.length > 1) {
      const d = disambiguate(viable, contractElement.disambig ?? "first_visible");
      if (d) {
        results.winner = d;
        results.byStrategy.push({ index: i, type: s.t, won: true, disambig: true });
        return results;
      }
      results.byStrategy.push({ index: i, type: s.t, won: false, reason: "disambig fail" });
      results.losses++;
      continue;
    }
    results.byStrategy.push({ index: i, type: s.t, won: false });
    results.losses++;
  }
  results.misses = 1;
  return results;
}

// ── discovery (spec 01 §6 L2) ──
export function discoveryScore(c, element, { telemetryAttrs = [] } = {}) {
  let s = 0;
  const roleWords = { trigger: ["button", "link", "menu"], field: ["textbox", "radio", "input"], indicator: ["dialog", "progress", "upload"], file_input: ["file"] };
  const wants = roleWords[element.role] ?? [];
  if (element.role !== "state" && wants.length) {
    const roleOk = wants.some((w) => (c.role ?? "").toLowerCase().includes(w) || w === c.tag || (c.ariaLabel ?? "").toLowerCase().includes(w));
    if (roleOk) s += 4;
  }
  const textVariants = element.strategies.filter((x) => x.t === "text").flatMap((x) => (Array.isArray(x.v) ? x.v : [x.v]));
  if (textVariants.some((v) => (c.text ?? "") === v || (c.ariaLabel ?? "") === v)) s += 4;
  if (telemetryAttrs.some((a) => a && (c.testId === a || c.name === a))) s += 3;
  s += 2;
  if (c.visible && !c.disabled) s += 1;
  return s;
}

export function discoverCandidate(candidates, element, { threshold = 8 } = {}) {
  if (element.role === "state" || element.allowDiscovery === false) return null;
  const scored = candidates
    .filter((c) => c.visible && !c.disabled)
    .map((c) => ({ c, s: discoveryScore(c, element) }))
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  const max = scored[0].s;
  if (max < threshold) return null;
  if (scored.filter((x) => x.s === max).length !== 1) return null;
  return scored[0].c;
}

export function makeMissError(element, probe = {}, meta = {}) {
  return make("SelectorMissError", `контрактный элемент «${element.label}» не резолвился (${probe.reason ?? "miss"})`, {
    probe: { label: element.label, zone: probe.zone ?? null, candidateCount: probe.candidateCount ?? null },
    ...meta,
  });
}
