// JSONL action log — каждое событие в state/logs/<date>.jsonl + опционально events-таблица.
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export function makeLogger(stateDir, { sink = null } = {}) {
  const dir = join(stateDir, "logs");
  mkdirSync(dir, { recursive: true });
  return (event) => {
    const now = new Date();
    const line = JSON.stringify({ at: now.toISOString(), ...event });
    try {
      appendFileSync(join(dir, `${now.toISOString().slice(0, 10)}.jsonl`), line + "\n");
    } catch {}
    if (sink) {
      try {
        sink(event);
      } catch {}
    }
  };
}
