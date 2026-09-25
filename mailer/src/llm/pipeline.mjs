// pipeline.mjs — LLM-конвейер на один lead (spec 03): research → classify → compose
// слиты в 1 structured-вызов (бюджет ≤1 вызов/lead). Кэш в llm_cache.
// Fail-closed: LlmError → lead в llm_failed, DM не шлём без вердикта.
import { make } from "../core/errors.mjs";
import { llmComplete, parseStructured, cacheKey, llmConfig } from "./client.mjs";
import { randomUUID } from "node:crypto";

export const PROMPT_VERSION = "v1";
const SYSTEM = `You are an outreach researcher for a type-beat catalog (Instagram).
Given facts about one lead, produce STRICT JSON:
{
  "relevance": 0..1 (uses our type-beat catalog?),
  "category": "artist" | "producer" | "label" | "fanpage" | "unknown",
  "active": true|false (posts/stories in last 30 days),
  "dm_worth": "yes"|"no",
  "dm_reason": "short reason",
  "tone": "casual" | "hype" | "professional",
  "personal_hook": "concrete track/fact from facts (REQUIRED, specific)",
  "draft": "1-3 sentences DM, casual opener, MUST mention the concrete track/hook, no 'Dear Sir', no placeholder artifacts like {{...}}, no quotes around the text"
}
Language of draft: match the lead's profile language (bio). No more than 3 sentences.`;

export function buildPrompt(lead, facts, beats) {
  return JSON.stringify(
    {
      task: "research+classify+compose",
      lead: { handle: lead.handle, artist: lead.artist ?? null, track: lead.track ?? null, source: lead.source ?? null },
      beat_catalog: (beats ?? []).slice(0, 20),
      facts,
      rules: [
        "relevance: number 0..1 — does this lead fit our type-beat catalog",
        "dm_worth=no → draft must still be produced but is ignored",
        "personal_hook must name the concrete track/beat the lead used",
      ],
    },
    null,
    0
  );
}

// Кэш-обёртка
export function getCached(db, key) {
  const row = db.prepare("SELECT payload, model FROM llm_cache WHERE key = ?").get(key);
  if (!row) return null;
  try {
    return { ...JSON.parse(row.payload), model: row.model };
  } catch {
    return null;
  }
}

export function putCached(db, key, payload, model) {
  db.prepare(
    "INSERT INTO llm_cache (key, payload, model) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, model=excluded.model, created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  ).run(key, JSON.stringify(payload), model);
}

// Валидация вердикта (fail-closed на мусоре)
export function validateVerdict(v) {
  const errors = [];
  if (typeof v.relevance !== "number" || v.relevance < 0 || v.relevance > 1) errors.push("relevance");
  if (!["artist", "producer", "label", "fanpage", "unknown"].includes(v.category)) errors.push("category");
  if (typeof v.active !== "boolean") errors.push("active");
  if (!["yes", "no"].includes(v.dm_worth)) errors.push("dm_worth");
  if (typeof v.draft !== "string" || !v.draft.trim()) errors.push("draft");
  if (typeof v.personal_hook !== "string" || !v.personal_hook.trim()) errors.push("personal_hook");
  if (!v.tone || typeof v.tone !== "string") errors.push("tone");
  if (errors.length) {
    throw make("LlmError", `вердикт некорректен: ${errors.join(", ")}`, { step: "llm_validate" });
  }
  // артефакты подстановки запрещены spec 03
  if (/\{\{|\}\}|\$\{|\{%\s*\w+\s*%\}/.test(v.draft)) {
    throw make("LlmError", "draft содержит placeholder-артефакты ({{...}})", { step: "llm_validate" });
  }
  return v;
}

// Основной вызов: lead → verdict (+кэш). facts — факт-блок ресерча (research.mjs).
export async function classifyLead({ db, lead, facts, beats, env = process.env, fetchImpl = fetch }) {
  const key = cacheKey(lead.handle, facts, PROMPT_VERSION);
  const cached = getCached(db, key);
  if (cached) return { verdict: cached, cached: true };

  const res = await llmComplete({
    system: SYSTEM,
    prompt: buildPrompt(lead, facts, beats),
    temperature: 0.7,
    cfg: llmConfig(env),
    fetchImpl,
  });
  const verdict = parseStructured(res.content);
  validateVerdict(verdict);
  putCached(db, key, { ...verdict, usage: res.usage, promptVersion: PROMPT_VERSION }, res.model);
  return { verdict, cached: false, model: res.model };
}

// Применение вердикта к lead в БД. Verdict no → rejected (DM не шлём).
export function applyVerdict(db, lead, verdict, model) {
  const worth = verdict.dm_worth === "yes";
  const status = worth ? "ready" : "rejected";
  db.prepare(
    `UPDATE leads SET relevance=?, dm_worth=?, tone=?, personal_hook=?, draft=?,
     llm_model=?, llm_ts=?, status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=?`
  ).run(
    verdict.relevance,
    worth ? 1 : 0,
    verdict.tone,
    verdict.personal_hook,
    worth ? verdict.draft : null,
    model ?? null,
    new Date().toISOString(),
    status,
    lead.id
  );
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(lead.id);
}

export function markLlmFailed(db, lead, error) {
  db.prepare(
    "UPDATE leads SET status='llm_failed', last_error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
  ).run(`${error.code}: ${error.message}`.slice(0, 300), lead.id);
}

// Батч: classify --limit N (IH_CLASSIFY_ONLY=1 = только LLM-слой, не шлём)
export async function classifyBatch({ db, limit = 20, beats = [], env = process.env, fetchImpl = fetch, factsProvider = null }) {
  const leads = db.prepare("SELECT * FROM leads WHERE status IN ('new','llm_failed') ORDER BY created_at LIMIT ?").all(limit);
  const out = [];
  for (const lead of leads) {
    try {
      const facts = factsProvider ? await factsProvider(lead) : { note: "no facts provider (Phase 3 research: ArtistConnect/IG/web)" };
      const { verdict, cached, model } = await classifyLead({ db, lead, facts, beats, env, fetchImpl });
      const updated = applyVerdict(db, lead, verdict, model);
      out.push({ lead: updated, cached });
    } catch (e) {
      if (e?.code === "LlmError") {
        markLlmFailed(db, lead, e);
        out.push({ lead, error: e.code });
      } else throw e;
    }
  }
  return out;
}

