// client.mjs — OpenRouter клиент (spec 03). Fail-closed: нет ключа/модели → LlmError.
import { make } from "../core/errors.mjs";

export const LLM_DEFAULT_MODEL = "deepseek/deepseek-chat-v4-flash";

export function llmConfig(env = process.env) {
  const apiKey = env.OPENROUTER_API_KEY || env.IH_OPENROUTER_KEY;
  if (!apiKey) throw make("LlmError", "OPENROUTER_API_KEY не задан (state/.env)", { step: "llm" });
  const model = env.IH_LLM_MODEL || LLM_DEFAULT_MODEL;
  return { apiKey, model, baseUrl: env.IH_LLM_BASE_URL || "https://openrouter.ai/api/v1" };
}

// Структурированный вызов: один запрос на lead (research+classify+compose слиты, spec 03).
export async function llmComplete({ prompt, system = null, temperature = 0, jsonMode = true, cfg = null, fetchImpl = fetch } = {}) {
  const c = cfg ?? llmConfig();
  const body = {
    model: c.model,
    temperature: temperature,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };
  let res;
  try {
    res = await fetchImpl(`${c.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    throw make("LlmError", `LLM transport: ${e.message}`, { step: "llm", probe: { retriable: true } });
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {}
    throw make("LlmError", `LLM ${res.status}: ${msg}`, { step: "llm", probe: { retriable: res.status === 429 || res.status >= 500 } });
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw make("LlmError", "LLM пустой ответ", { step: "llm" });
  return { content, model: j.model ?? c.model, usage: j.usage ?? null };
}

// Парсинг structured-ответа: JSON или fail (fail-closed: мусор → LlmError)
export function parseStructured(content) {
  let text = String(content).trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (m) text = m[1];
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object") throw new Error("not an object");
    return obj;
  } catch (e) {
    throw make("LlmError", `structured-ответ не распарсен: ${e.message}`, { step: "llm_parse" });
  }
}

// Кэш-ключ spec 03: sha256(handle|facts|promptVersion)
import { createHash } from "node:crypto";
export function cacheKey(handle, facts, promptVersion) {
  return createHash("sha256").update(`${handle}|${JSON.stringify(facts)}|${promptVersion}`).digest("hex");
}
