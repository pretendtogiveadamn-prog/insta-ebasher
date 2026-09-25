// research.mjs — сбор факт-блока о лиде (spec 03 §1 / spec 00 «Качество ресерча»).
// Источники: профиль IG через браузер (bio/followers/посты), ArtistConnect (Phase 3,
// нужен логиненный профиль), веб (опц.). MVP: IG-профиль через прикреплённую вкладку.
import { make } from "../core/errors.mjs";
import { saveEvidence } from "../core/evidence.mjs";

// Сбор фактов с открытой страницы профиля IG (Playwright page или мок)
export async function collectProfileFacts(page, { stateDir = null, jobId = null } = {}) {
  const facts = await page
    .evaluate(() => {
      const meta = (sel) => document.querySelector(sel)?.getAttribute?.("content") ?? null;
      const bio = document.querySelector("header section, header > div > div:nth-child(2)")?.innerText ?? null;
      const links = [...document.querySelectorAll("header a[href*='/p/'], main a[href*='/p/']")].length;
      const stats = {};
      for (const el of document.querySelectorAll("header span")) {
        const m = /([\d.,]+[KMkm]?)\s*(posts|followers|following|подписчики|подписков|публикаций)/i.exec(el.innerText ?? "");
        if (m) stats[m[2].toLowerCase()] = m[1];
      }
      return {
        url: location.pathname,
        bio: (bio ?? "").slice(0, 600),
        postsCount: stats.posts ?? null,
        followers: stats.followers ?? null,
        following: stats.following ?? null,
        recentPostLinks: links,
        ogDescription: meta("meta[property='og:description']"),
      };
    })
    .catch((e) => {
      throw make("SessionError", `сбор фактов профиля не удался: ${e.message}`, { step: "research" });
    });
  if (stateDir && jobId) {
    await saveEvidence({ stateDir, jobId, step: "research_profile", page, dom: facts, meta: { source: "ig_profile" } }).catch(() => {});
  }
  return facts;
}

// Факт-блок → стабильный payload для кэш-ключа
export function factsSnapshot(facts) {
  return { ig_profile: facts ?? null };
}
