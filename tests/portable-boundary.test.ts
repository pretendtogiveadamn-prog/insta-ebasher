import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const text = (path: string) => readFileSync(join(root, path), "utf8");

describe("portable client boundary", () => {
  it("does not reintroduce a browser-launcher or stealth dependency", () => {
    const pkg = JSON.parse(text("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ").toLowerCase();
    for (const forbidden of ["patchright", "playwright", "puppeteer", "selenium"]) expect(names).not.toContain(forbidden);
  });

  it("keeps browser, proxy and cookie handling out of executable source", () => {
    const source = text("src/server.ts") + text("src/store.ts") + text("src/config.ts");
    for (const forbidden of ["launchpersistentcontext", "launch(", "proxyserver", "browser-profiles", "cookiejar", "addcookies", "stealth-browser"]) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("states the Chrome MCP-only boundary for the operator agent", () => {
    const rules = text("AGENTS.md");
    expect(rules).toContain("Chrome MCP");
    expect(rules).toContain("Do not launch a browser");
  });
});
