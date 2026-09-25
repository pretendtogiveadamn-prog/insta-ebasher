// beats.mjs — каталог наших битов (название/настроение) для compose (spec 03).
// MVP: config/beats.yaml. По-настоящему каталог живёт в 1.0/CRM — подключение в Phase 3.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadBeats(rootDir = ROOT) {
  const file = join(rootDir, "config", "beats.yaml");
  if (!existsSync(file)) return [];
  return yaml.load(readFileSync(file, "utf8"))?.beats ?? [];
}
