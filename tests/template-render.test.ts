import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";

const clean: Array<{ store: Store; dir: string }> = [];
afterEach(() => clean.splice(0).forEach(({ store, dir }) => { store.close(); rmSync(dir, { recursive: true, force: true }); }));

describe("server-rendered first DM", () => {
  it("normalizes both {{handle}} and @{{handle}} to one Instagram @", () => {
    const dir = mkdtempSync(join(tmpdir(), "insta-ebasher-template-"));
    const store = new Store(join(dir, "data", "app.sqlite")); clean.push({ store, dir });
    const account = store.account("Test"); store.heartbeat(account.id, "available", "test.account");
    const lead = store.lead({ handle: "artist.one", verdict: "artist", confidence: 90, source: { seed: "p", type: "follower", url: "https://instagram.com/p" }, evidence: [{ kind: "release", url: "https://spotify.com/x", note: "release" }] }).lead;
    store.setLead(lead.id, "ready", "approved");
    const template = store.template({ name: "T", variant: "A", body: "Hi @{{handle}} / {{handle}}" }); store.approveTemplate(template.id);
    const campaign = store.campaign({ name: "C", templateId: template.id }); store.addReady(campaign.id); store.campaignState(campaign.id, "approve"); store.campaignState(campaign.id, "start");
    const lease = store.outreach(account.id, 35, true);
    expect(lease.payload.target.message).toBe("Hi @artist.one / @artist.one");
  });
});
