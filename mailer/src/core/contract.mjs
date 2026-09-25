// Contract parser/validator — spec 01 (модель ytbot-2): контракт = YAML, строгая валидация.
// Статусы: pending → verified (только live-аудит, at + evidence обязательны).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROLES = ["trigger", "field", "state", "indicator"];
const STRATEGY_TYPES = ["css", "shadow", "text", "attr", "xpath"];
const DISAMBIGS = ["first_visible", "last_visible", "closest", "nth"];
const FORBIDDEN_CSS = [":contains", ":has-text"];
const VERIFIED_STATUS = ["verified", "pending", "stale", "failed"];

export function parseContract(yamlText, zoneName = "?") {
  let doc;
  try {
    doc = yaml.load(yamlText);
  } catch (e) {
    throw new Error(`contract ${zoneName}: YAML parse error: ${e.message}`);
  }
  validateContract(doc, zoneName);
  return doc;
}

export function validateContract(doc, zoneName) {
  if (!doc || typeof doc !== "object") throw new Error(`contract ${zoneName}: пустой`);
  if (!Number.isInteger(doc.version) || doc.version < 1) {
    throw new Error(`contract ${zoneName}: version обязателен (int >= 1)`);
  }
  if (!Array.isArray(doc.elements) || doc.elements.length === 0) {
    throw new Error(`contract ${zoneName}: elements[] обязателен`);
  }
  const labels = new Set();
  for (const el of doc.elements) {
    if (!el.label) throw new Error(`contract ${zoneName}: элемент без label`);
    if (labels.has(el.label)) throw new Error(`contract ${zoneName}: дубликат label «${el.label}»`);
    labels.add(el.label);
    if (!ROLES.includes(el.role)) {
      throw new Error(`contract ${zoneName}/${el.label}: role=${el.role} не из ${ROLES.join("|")}`);
    }
    if (!Array.isArray(el.strategies) || el.strategies.length === 0) {
      throw new Error(`contract ${zoneName}/${el.label}: strategies[] обязателен`);
    }
    let xpathCount = 0;
    for (const s of el.strategies) {
      if (!STRATEGY_TYPES.includes(s.t)) {
        throw new Error(`contract ${zoneName}/${el.label}: тип стратегии ${s.t} не из ${STRATEGY_TYPES.join("|")}`);
      }
      if (s.t === "xpath") xpathCount++;
      if (s.t === "css") {
        const bad = FORBIDDEN_CSS.find((f) => String(s.v).includes(f));
        if (bad) throw new Error(`contract ${zoneName}/${el.label}: ${bad} запрещён в css (текст ищется стратегией text)`);
      }
      if (s.t === "text" && !s.v) {
        throw new Error(`contract ${zoneName}/${el.label}: text-стратегия без v`);
      }
    }
    if (xpathCount > 1) throw new Error(`contract ${zoneName}/${el.label}: максимум 1 xpath на элемент (last-ditch)`);
    if (el.disambig !== undefined) {
      const [kind] = String(el.disambig).split(":");
      if (!DISAMBIGS.includes(kind)) {
        throw new Error(`contract ${zoneName}/${el.label}: disambig=${el.disambig} не из ${DISAMBIGS.join("|")}`);
      }
    }
    const status = el.verified?.status ?? "pending";
    if (!VERIFIED_STATUS.includes(status)) {
      throw new Error(`contract ${zoneName}/${el.label}: verified.status=${status} не из ${VERIFIED_STATUS.join("|")}`);
    }
    if (status === "verified" && (!el.verified.at || !el.verified.evidence)) {
      throw new Error(`contract ${zoneName}/${el.label}: verified требует at + evidence (только live-аудит)`);
    }
    if (el.role === "state" && el.allowDiscovery === true) {
      throw new Error(`contract ${zoneName}/${el.label}: state-элементам discovery запрещён`);
    }
  }
  return true;
}

export function loadZone(rootDir, zoneName) {
  const file = join(rootDir, "contracts", `${zoneName}.yaml`);
  if (!existsSync(file)) throw new Error(`contract zone не найдена: ${file}`);
  return { zone: zoneName, ...parseContract(readFileSync(file, "utf8"), zoneName), file };
}

export function loadAllZones(rootDir) {
  const dir = join(rootDir, "contracts");
  if (!existsSync(dir)) throw new Error(`contracts dir не найден: ${dir}`);
  const zones = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(".yaml", ""));
  return zones.map((z) => loadZone(rootDir, z));
}

export function contractStatuses(zones) {
  const out = {};
  for (const z of zones) {
    out[z.zone] = {};
    for (const el of z.elements) out[z.zone][el.label] = el.verified?.status ?? "pending";
  }
  return out;
}

// gate для live-действий: элементы, влияющие на отправку, должны быть verified.
// pending разрешён только в dry-run/audit (spec 06 Phase 2).
// role=state — read-only индикаторы/кодовые проверки (bio, network_send_ok, url-checks):
// они не нажимаются и не вводятся → live не блокируют (2026-09-25).
export function liveGateOk(zones, requiredZones) {
  const missing = [];
  for (const z of zones) {
    if (requiredZones && !requiredZones.includes(z.zone)) continue;
    for (const el of z.elements) {
      if (el.role === "state") continue;
      if ((el.verified?.status ?? "pending") !== "verified") missing.push(`${z.zone}/${el.label}`);
    }
  }
  return { ok: missing.length === 0, missing };
}
