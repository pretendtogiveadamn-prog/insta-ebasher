// Evidence — spec 00: state/evidence/<leadId or jobId>/<step>/ {screenshot.png, dom.json, meta.json}.
// Retention: keep last N job dirs, older mv -> state/_trash/ (никогда не rm).
import { mkdirSync, writeFileSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const RETENTION_KEEP = 50;

export function evidenceRoot(stateDir) {
  return join(stateDir, "evidence");
}

export function jobEvidenceDir(stateDir, jobId, step) {
  return join(evidenceRoot(stateDir), jobId, step);
}

export async function saveEvidence({ stateDir, jobId, step, page, dom, meta }) {
  const dir = jobEvidenceDir(stateDir, jobId, step);
  mkdirSync(dir, { recursive: true });
  if (page) {
    try {
      await page.screenshot({ path: join(dir, "screenshot.png"), fullPage: false });
    } catch {
      // страница могла упасть — dom/meta всё равно пишем
    }
  }
  if (dom !== undefined) {
    writeFileSync(join(dir, "dom.json"), JSON.stringify(dom, null, 2));
  }
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify(
      {
        jobId,
        step,
        capturedAt: new Date().toISOString(),
        url: page ? safeUrl(page) : null,
        ...meta,
      },
      null,
      2
    )
  );
  return dir;
}

function safeUrl(page) {
  try {
    return page.url();
  } catch {
    return null;
  }
}

// mv в _trash вместо удаления (правило README).
export function applyEvidenceRetention(stateDir, keep = RETENTION_KEEP) {
  const root = evidenceRoot(stateDir);
  let dirs;
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name))
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  } catch {
    return { moved: 0 };
  }
  if (dirs.length <= keep) return { moved: 0 };
  const trash = join(stateDir, "_trash", "evidence");
  mkdirSync(trash, { recursive: true });
  let moved = 0;
  for (const dir of dirs.slice(0, dirs.length - keep)) {
    const dest = join(trash, `${basename(dir)}-${Date.now()}`);
    try {
      renameSync(dir, dest);
      moved++;
    } catch {}
  }
  return { moved };
}
