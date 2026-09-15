import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { join } from "node:path";

describe("operator panel", () => {
  it("is valid JavaScript before it is served to the operator", () => {
    expect(() => execFileSync(process.execPath, ["--check", join(process.cwd(), "public", "app.js")], { stdio: "pipe" })).not.toThrow();
  });
});
