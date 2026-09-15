import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";

const items: Array<{ store: Store; dir: string }> = [];
function fixture() { const dir = mkdtempSync(join(tmpdir(), "insta-ebasher-audit-")); const store = new Store(join(dir, "data", "app.sqlite")); items.push({ store, dir }); return store; }
afterEach(() => items.splice(0).forEach(({ store, dir }) => { store.close(); rmSync(dir, { recursive: true, force: true }); }));
const candidate = (handle: string, jobId?: string) => ({ handle, jobId, verdict: "artist", confidence: 90, source: { seed: "producer", type: "follower", url: "https://instagram.com/producer" }, evidence: [{ kind: "release", url: "https://spotify.com/a", note: "release" }] });

describe("audit regression contracts", () => {
  it("does not accept an invented research job ID", () => {
    const store = fixture();
    expect(() => store.lead(candidate("artist.one", "missing-job"))).toThrow("Unknown jobId");
  });

  it("creates a newly discovered blocked handle directly as DNC", () => {
    const store = fixture();
    store.db.prepare("INSERT INTO blocklist(handle,created) VALUES(?,?)").run("blocked.artist", new Date().toISOString());
    expect(store.lead(candidate("blocked.artist")).lead.state).toBe("dnc");
  });

  it("requires the requested account itself to have a fresh Chrome heartbeat", () => {
    const store = fixture();
    const ready = store.lead(candidate("artist.one")).lead; store.setLead(ready.id, "ready", "approved");
    const template = store.template({ name: "A", variant: "A", body: "Hi {{handle}}" }); store.approveTemplate(template.id);
    const campaign = store.campaign({ name: "C", templateId: template.id }); store.addReady(campaign.id); store.campaignState(campaign.id, "approve"); store.campaignState(campaign.id, "start");
    const warm = store.account("warm"); store.heartbeat(warm.id, "available", "warm.account");
    const cold = store.account("cold");
    expect(() => store.outreach(cold.id, 35, false)).toThrow("Chrome MCP is not ready");
  });
});
