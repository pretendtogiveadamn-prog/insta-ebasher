// classify CLI — LLM-слой (research→classify→compose), spec 03. IH_CLASSIFY_ONLY=1 — по умолчанию.
import { STATE_DIR, DB_PATH } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { makeLogger } from "../core/log.mjs";
import { classifyBatch } from "../llm/pipeline.mjs";
import { loadBeats } from "../llm/beats.mjs";

export async function cmdClassify({ limit = 20 } = {}) {
  const db = openDb(DB_PATH);
  const logger = makeLogger(STATE_DIR);
  const beats = loadBeats();
  const out = await classifyBatch({ db, limit: Number(limit) || 20, beats });
  for (const r of out) {
    if (r.error) {
      console.log(`${r.lead.id.slice(0, 8)} @${r.lead.handle} → llm_failed (${r.error})`);
    } else {
      const v = r.lead;
      console.log(`${v.id.slice(0, 8)} @${v.handle} → ${v.status}${r.cached ? " (cached)" : ""} rel=${v.relevance} hook="${v.personal_hook}"`);
    }
  }
  if (!out.length) console.log("лидов new/llm_failed нет — ih leads add --handle @x …");
}
