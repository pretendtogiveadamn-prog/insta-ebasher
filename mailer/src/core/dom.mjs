// dom.mjs — shadow-walk + probe-снапшоты. Работает через page.evaluate (Playwright-совместимый интерфейс).
// Никогда не назначаем el.id в проде (1.0-антипаттерн) — WeakMap + путь через shadow-hosts.

export const NORMALIZE_NOTE = "атрибуты отсортированы; динамические классы-жетоны (>=16 симв., без дефисов в слове) вырезаны; id/aria/data-test-id/текст сохранены";

export function normalizeClassName(cls) {
  return String(cls)
    .split(/\s+/)
    .filter(Boolean)
    .filter((c) => !(c.length >= 16 && !c.includes("-")))
    .join(" ");
}

export function normalizeNode(node, { maxText = 120 } = {}) {
  const out = { tag: (node.tag || "").toLowerCase() };
  if (node.id) out.id = node.id;
  const attrs = {};
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (k === "class") {
      const c = normalizeClassName(v);
      if (c) attrs.class = c;
    } else {
      attrs[k] = v;
    }
  }
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (node.role) out.role = node.role;
  if (node.disabled) out.disabled = true;
  if (node.visible) out.visible = true;
  const text = (node.text ?? "").trim();
  if (text) out.text = text.slice(0, maxText);
  if (Array.isArray(node.children)) {
    const kids = node.children.map((c) => normalizeNode(c, { maxText }));
    if (kids.length) out.children = kids;
  }
  if (node.shadowRoot) out.shadowRoot = normalizeNode(node.shadowRoot, { maxText });
  return out;
}

// Сбор поддерева DOM + shadowRoots одним evaluate-вызовом (страница — Playwright Page или мок)
export async function snapshotZone(page, { scopeSelector = null, maxNodes = 1200, maxDepth = 40 } = {}) {
  return await page.evaluate(
    ({ scopeSelector, maxNodes, maxDepth }) => {
      const DYNAMIC_CLASS = /^[A-Za-z0-9_-]{16,}$/;
      const collect = (root, depth, budget) => {
        if (budget.count >= maxNodes || depth > maxDepth) return null;
        const dump = (node) => {
          if (!node || budget.count >= maxNodes) return null;
          budget.count++;
          const d = { tag: node.tagName };
          if (node.id) d.id = node.id;
          const attrs = {};
          for (const a of node.attributes ?? []) {
            if (a.name === "class") {
              const c = String(a.value).split(/\s+/).filter((x) => x && !DYNAMIC_CLASS.test(x)).join(" ");
              if (c) attrs.class = c;
            } else if (["aria-label", "role", "name", "test-id", "type", "href", "accept", "value", "aria-label"].includes(a.name)) {
              attrs[a.name] = a.value;
            }
          }
          if (node.getAttribute?.("aria-label")) attrs["aria-label"] = node.getAttribute("aria-label");
          if (Object.keys(attrs).length) d.attrs = attrs;
          const cs = typeof window !== "undefined" && node.getBoundingClientRect ? window.getComputedStyle(node) : null;
          d.visible = !!(cs && cs.display !== "none" && cs.visibility !== "hidden" && node.offsetWidth + node.offsetHeight > 0);
          d.disabled = Boolean(node.disabled);
          d.role = node.getAttribute?.("role") ?? null;
          if (d.role === null) delete d.role;
          const text = (node.textContent ?? "").trim();
          if (node.childElementCount === 0 && text) d.text = text.slice(0, 120);
          const kids = [];
          for (const child of node.children ?? []) {
            const cd = collect(child, depth + 1, budget);
            if (cd) kids.push(cd);
          }
          if (kids.length) d.children = kids;
          if (node.shadowRoot) {
            const sr = collect(node.shadowRoot, depth + 1, budget);
            if (sr) d.shadowRoot = sr;
          }
          return d;
        };
        return dump(node);
      };
      let root;
      if (scopeSelector) {
        root = document.querySelector(scopeSelector);
        if (!root) return { nodes: [], count: 0, note: "scope not found" };
        // scope-элемент сам не дампим — дампим его детей (зона)
        const kids = [];
        const budget = { count: 0 };
        for (const child of root.children) {
          const cd = collect(child, 0, budget);
          if (cd) kids.push(cd);
        }
        return { nodes: kids, count: budget.count };
      }
      root = document.body;
      const kids = [];
      const budget = { count: 0 };
      for (const child of root.children) {
        const cd = collect(child, 0, budget);
        if (cd) kids.push(cd);
      }
      return { nodes: kids, count: budget.count };
    },
    { scopeSelector, maxNodes, maxDepth }
  );
}

// deepQuery: рекурсивный walk по shadowRoot + light DOM. Возвращает ЧИСТЫЕ сериализуемые
// кандидаты (функции через Playwright не сериализуются) — скоринг делает resolver.
export async function deepQuery(page, { cssSelector = "*", limit = 500 } = {}) {
  return await page.evaluate(({ cssSelector, limit }) => {
    const out = [];
    const ancestorTags = (el) => {
      const tags = [];
      let cur = el;
      while (cur) {
        if (cur.tagName) tags.push(String(cur.tagName).toLowerCase());
        else if (cur.host) tags.push(String(cur.host.tagName).toLowerCase());
        cur = cur.host ?? cur.parentElement;
      }
      return tags;
    };
    const walk = (root, hostChain, depth) => {
      if (depth > 20 || out.length >= limit) return;
      let matched = [];
      try { matched = Array.from(root.querySelectorAll(cssSelector)); } catch { matched = []; }
      for (const el of matched) {
        if (out.length >= limit) break;
        out.push(makeCandidate(el, hostChain));
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const next = [...hostChain, String(el.tagName).toLowerCase()];
          walk(el.shadowRoot, next, depth + 1);
        }
      }
    };
    const makeCandidate = (el, hostChain) => {
      let cs = null;
      try { cs = window.getComputedStyle(el); } catch {}
      let box = null;
      try {
        const r = el.getBoundingClientRect();
        if (r && (r.width || r.height)) box = { x: r.x, y: r.y, w: r.width, h: r.height };
      } catch {}
      return {
        hostChain: [...hostChain],
        tag: String(el.tagName ?? "").toLowerCase(),
        id: el.id || null,
        classes: String(el.className ?? "").split(/\s+/).filter(Boolean).slice(0, 12),
        name: el.getAttribute?.("name") ?? null,
        accept: el.getAttribute?.("accept") ?? null,
        type: el.getAttribute?.("type") ?? null,
        href: el.getAttribute?.("href") ?? null,
        placeholder: el.getAttribute?.("placeholder") ?? null,
        text: (el.textContent ?? "").trim().slice(0, 200),
        ariaLabel: el.getAttribute?.("aria-label") ?? null,
        testId: el.getAttribute?.("test-id") ?? null,
        role: el.getAttribute?.("role") ?? null,
        visible: cs ? cs.display !== "none" && cs.visibility !== "hidden" : true,
        disabled: Boolean(el.disabled ?? el.getAttribute?.("disabled")),
        ancestors: (el.parentElement ? ancestorTags(el.parentElement) : []).slice(0, 30),
        box,
      };
    };
    walk(document, [], 0);
    return out;
  }, { cssSelector, limit });
}
