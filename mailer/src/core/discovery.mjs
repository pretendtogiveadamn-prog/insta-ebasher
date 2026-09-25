// discovery.mjs — само-хилинг селекторов (детерминированные правила, не LLM).
// Если все стратегии контракта промахнулись (DOM IG обновился) — discovery ищет элемент
// по семантическим признакам (роль/текст/aria/placeholder) и ПРЕДЛАГАЕТ новую стратегию:
// она дописывается в contracts/*.yaml (status pending + note discovered) → следующий прогон
// работает без discovery, владелец подтверждает через `ih audit --apply`.
//
// АНТИ-САМООБМАН (урок мёртвых правил 2026-09-24):
// - правила работают с ПЛОСКИМИ кандидатами deepQuery (tag lowercase, ariaLabel, placeholder,
//   href, name, role, box — НЕ c.attrs.*, НЕ "H1");
// - правило обязано дать РОВНО ОДНИН сильный матч (unique) — иначе null (лучше miss, чем
//   клик не туда);
// - предложенная стратегия валидируется re-resolve на тех же кандидатах: должна находить
//   того же победителя, иначе в контракт не пишем;
// - role=state и allowDiscovery:false никогда не хилятся (contract-элемент читается).
import { loadZone } from "./contract.mjs";
import { matchStrategy } from "./resolver.mjs";
import { writeFileSync } from "node:fs";
import { deepQuery } from "./dom.mjs";

const firstLine = (s) => String(s ?? "").split("\n")[0].trim();

// ровно один сильный матч — иначе null (анти-фолс-позитив)
const unique = (cs, pred) => {
  const hit = cs.filter((c) => c.visible && !c.disabled && pred(c));
  return hit.length === 1 ? hit[0] : null;
};

// правила: (зона/элемент) → предикат по ПЛОСКИМ кандидатам deepQuery
export const DISCOVERY_RULES = {
  // кнопка Message на профиле: buttonish + точный текст (не "Messages" топ-бара)
  "profile/profile_message_button": (cs) =>
    unique(
      cs,
      (c) =>
        ["div", "span", "button"].includes(c.tag) &&
        (c.role === "button" || (c.ancestors ?? []).includes("header")) &&
        /^(message|сообщение)$/i.test(firstLine(c.text))
    ),
  "profile/header_username": (cs) => unique(cs, (c) => c.tag === "h1" && firstLine(c.text).replace(/^@/, "").length > 0),
  "thread/composer": (cs) => unique(cs, (c) => c.role === "textbox"),
  "thread/composer_placeholder": (cs) =>
    unique(cs, (c) => c.role === "textbox" && /message|сообщение/i.test(String(c.placeholder ?? c.text ?? ""))),
  "direct-new/search_input": (cs) =>
    unique(cs, (c) => c.tag === "input" && /search|поиск/i.test(String(c.placeholder ?? c.name ?? ""))),
  "direct-new/result_row": null, // точный хэндл-матч — только код dm.mjs (TRAPS #5)
  "login/nav_own_profile_link": (cs) => unique(cs, (c) => c.tag === "a" && c.href === "/direct/inbox/"),
  "send-confirm/sent_status_icon": (cs) =>
    unique(cs, (c) => c.tag === "svg" && /^(sent|delivered|seen|отправлено|доставлено|просмотрено)$/i.test(String(c.ariaLabel ?? ""))),
};

// предложить CSS-стратегию из найденного кандидата (стабильные признаки, не классы-жетоны)
export function suggestStrategy(c) {
  if (!c) return null;
  if (c.name && c.tag === "input") return { t: "css", v: `input[name='${c.name}']` };
  if (c.ariaLabel) return { t: "css", v: `${c.tag}[aria-label='${c.ariaLabel}']` };
  if (c.role) return { t: "css", v: `${c.tag}[role='${c.role}']` };
  if (c.placeholder) return { t: "css", v: `${c.tag}[placeholder*='${c.placeholder.slice(0, 12)}']` };
  return { t: "css", v: c.tag };
}

// self-check: предложенная стратегия на тех же кандидатах находит ТОГО ЖЕ победителя
export function validateSuggestion(strategy, candidates, winner) {
  if (!strategy || !winner) return false;
  let matched = [];
  try {
    matched = matchStrategy(strategy, candidates);
  } catch {
    return false;
  }
  const viable = matched.filter((c) => c.visible && !c.disabled);
  return viable.includes(winner);
}

// live-поиск: deepQuery → правило → {winner, strategy} (strategy уже провалидирована)
export async function discoverElement(page, zone, label, { cssSelector = "*", limit = 4000 } = {}) {
  const rule = DISCOVERY_RULES[`${zone}/${label}`];
  if (!rule) return null;
  const candidates = await deepQuery(page, { cssSelector, limit });
  const winner = rule(candidates);
  if (!winner) return null;
  const strategy = suggestStrategy(winner);
  if (!validateSuggestion(strategy, candidates, winner)) return null;
  return { winner, strategy };
}

// проверка по контракту: хилинг разрешён этому элементу? (rootDir — от вызывающего)
export function discoveryAllowed(rootDir, zone, label) {
  try {
    const z = loadZone(rootDir, zone);
    const el = z.elements.find((e) => e.label === label);
    if (!el) return false;
    if (el.role === "state") return false;
    if (el.allowDiscovery === false) return false;
    return true;
  } catch {
    return false;
  }
}

// дописать найденную стратегию в контракт (idempotent: дубли не пишем; verified не трогаем)
export function recordDiscovery(rootDir, zone, label, strategy, note = "") {
  if (!strategy) return false;
  const z = loadZone(rootDir, zone);
  const el = z.elements.find((e) => e.label === label);
  if (!el) return false;
  if (el.role === "state" || el.allowDiscovery === false) return false; // анти-самообман
  const exists = el.strategies.some((s) => s.t === strategy.t && s.v === strategy.v);
  if (exists) return false;
  el.strategies.push(strategy);
  el.notes = `${el.notes ?? ""} | discovered ${new Date().toISOString().slice(0, 10)}${note ? ` ${note}` : ""} (pending → ih audit --apply)`.trim();
  writeFileSync(z.file, yamlDump(z));
  return true;
}

// отдельный dump (не импортим js-yaml сверху — единая точка)
import yaml from "js-yaml";
function yamlDump(doc) {
  return yaml.dump(doc, { lineWidth: 120 });
}
