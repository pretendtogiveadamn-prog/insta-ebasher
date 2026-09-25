// ВАЖНО: evaluate в Playwright сериализует fn и передаёт только arg;
// fn использует глобальные document/location. В тестах мы эмулируем это через
// hijack: перед вызовом подменяем глобалы.
export async function withFakeDom(html, fn, arg = null) {
  const g = globalThis;
  const savedDoc = g.document;
  const savedLoc = g.location;
  const fakeDoc = {
    body: { innerText: html.bodyText ?? "" },
    querySelector: (sel) => {
      if (sel === "header a[href^='/']") return { getAttribute: () => html.headerHref ?? null };
      if (sel === "header h2, header span") return { innerText: html.headerText ?? "", textContent: html.headerText ?? "", getAttribute: () => null };
      if (sel === "div[role='dialog']") return html.dialogText !== undefined ? { innerText: html.dialogText, getAttribute: () => null } : null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === "svg[aria-label]") return (html.statusIcons ?? []).map((label) => ({ getAttribute: () => label }));
      if (sel === "div[role='dialog'] img") return Array.from({ length: html.gridImgs ?? 0 }, () => ({}));
      if (sel === "header span") return html.statSpans ?? [];
      if (sel === "header a[href*='/p/'], main a[href*='/p/']") return Array.from({ length: html.postLinks ?? 0 }, () => ({}));
      return [];
    },
  };
  const fakeLoc = g.location ?? new URL(html.url ?? "https://instagram.com/");
  if (html.url) {
    try {
      g.location = new URL(html.url);
    } catch {
      g.location = savedLoc;
    }
  }
  g.document = fakeDoc;
  try {
    return await fn(arg);
  } finally {
    g.document = savedDoc;
    if (savedLoc === undefined) delete g.location;
    else g.location = savedLoc;
  }
}
