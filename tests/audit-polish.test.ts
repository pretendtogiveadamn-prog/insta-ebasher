import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";

const clean: Array<{ store: Store; dir: string }> = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "insta-ebasher-polish-"));
  const store = new Store(join(dir, "data", "app.sqlite"));
  clean.push({ store, dir });
  const account = store.account("IG");
  store.heartbeat(account.id, "available", "ig.account");
  const lead = store.lead({ handle: "polish.artist", verdict: "artist", confidence: 90, source: { seed: "producer", type: "follower", url: "https://instagram.com/producer" }, evidence: [{ kind: "release", url: "https://spotify.com/a", note: "public release" }] }).lead;
  store.setLead(lead.id, "ready", "approved");
  const template = store.template({ name: "T", variant: "A", body: "Hi {{handle}}" }); store.approveTemplate(template.id);
  const campaign = store.campaign({ name: "C", templateId: template.id }); store.addReady(campaign.id); store.campaignState(campaign.id, "approve"); store.campaignState(campaign.id, "start");
  return { store, account, lead };
}
afterEach(() => clean.splice(0).forEach(({ store, dir }) => { store.close(); rmSync(dir, { recursive: true, force: true }); }));

describe("audit polish", () => {
  it("rejects malformed candidate fields before persisting them", () => {
    const { store } = setup();
    expect(() => store.lead({ handle: "bad.artist", verdict: "artist", confidence: 90, source: { seed: "p", type: "follower", url: "https://instagram.com/p" }, evidence: [{ kind: "release", url: "https://spotify.com/x", note: "release" }], followers: -1 })).toThrow("followers");
    expect(() => store.lead({ handle: "bad2.artist", verdict: "artist", confidence: 90, source: { seed: "", type: "follower", url: "https://instagram.com/p" }, evidence: [{ kind: "release", url: "https://spotify.com/x", note: "release" }] })).toThrow("source.seed");
  });

  it("reports a blocked live state with a machine-readable stop reason", () => {
    const { store, account } = setup();
    store.heartbeat(account.id, "login_required", "ig.account");
    expect(store.state(35, false)).toMatchObject({ mode: "blocked", chrome: "unavailable", stopReason: "login_required", rulesVersion: "2026-09-14" });
  });

  it("keeps a newer reply state when a late sent outcome arrives", () => {
    const { store, account, lead } = setup();
    const lease = store.outreach(account.id, 35, false);
    store.setLead(lead.id, "contacted", "external_contact");
    store.setLead(lead.id, "replied", "reply");
    expect(store.outcome(lease.id, { outcome: "sent", observedHandle: lead.handle }).state).toBe("replied");
    expect(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='sent_after_state_advanced'").get()).toMatchObject({ n: 1 });
  });

  it("keeps complete counts while returning a bounded lead page", () => {
    const { store } = setup();
    for (let i = 0; i < 3; i++) store.lead({ handle: `page${i}.artist`, verdict: "artist", confidence: 90, source: { seed: "p", type: "follower", url: "https://instagram.com/p" }, evidence: [{ kind: "release", url: "https://spotify.com/x", note: "release" }] });
    const snapshot = store.snapshot(35, true, 2);
    expect(snapshot.research.leads).toHaveLength(2);
    expect(snapshot.research.counts.total).toBe(4);
    expect(snapshot.research.counts.review).toBe(3);
  });

  it("does not turn a non-US phone into a contact", () => {
    const { store, account, lead } = setup();
    store.setLead(lead.id, "contacted", "dm_sent");
    const lease = store.inboxLease(account.id);
    const result = store.inboxEvent({ accountId: account.id, leaseId: lease.id, handle: lead.handle, kind: "phone_shared", phoneRaw: "+7 912 123 45 67", body: "call me", receivedAt: new Date().toISOString() }, "+7");
    expect(result.event.phone).toBeNull();
    expect(store.leadBy(lead.id)?.state).toBe("contacted");
    expect(store.leadBy(lead.id)?.contact.phoneRaw).toBe("+7 912 123 45 67");
  });

  it("keeps a duplicate research source and evidence in immutable history", () => {
    const { store, lead } = setup();
    const result = store.lead({ handle: lead.handle, verdict: "artist", confidence: 95, source: { seed: "studio", type: "follower", url: "https://instagram.com/studio" }, evidence: [{ kind: "performance", url: "https://youtube.com/watch?v=x", note: "live performance" }] });
    const audit = store.db.prepare("SELECT detail FROM audit WHERE kind='duplicate_source' AND lead_id=?").get(lead.id) as { detail: string };
    expect(result.duplicate).toBe(true);
    expect(JSON.parse(audit.detail)).toMatchObject({ source: { seed: "studio" }, evidence: [{ kind: "performance" }] });
  });

  it("persists a client-requested daily limit within the hard safety cap", () => {
    const { store } = setup();
    expect(store.dailyLimit(35)).toBe(35);
    expect(store.setDailyLimit(12)).toBe(12);
    expect(store.dailyLimit(35)).toBe(12);
    expect(() => store.setDailyLimit(36)).toThrow("Daily limit");
  });

  it("remembers clear rejects and only counts delegated qualifying artists", () => {
    const { store } = setup();
    const job = store.job({ name: "US artists", seeds: ["producer"], sources: ["follower"], targetCount: 1 });
    const strong = store.lead({ handle: "strong.artist", verdict: "artist", confidence: 80, followers: 100, source: { seed: "producer", type: "follower", url: "https://instagram.com/producer" }, evidence: [{ kind: "release", url: "https://spotify.com/strong", note: "public release" }] }).lead;
    const nonArtist = store.lead({ handle: "brand.page", verdict: "not_artist", confidence: 95, followers: 1000, source: { seed: "producer", type: "following", url: "https://instagram.com/producer" }, evidence: [{ kind: "brand", url: "https://instagram.com/brand.page", note: "brand profile" }] }).lead;
    expect(store.autoApprove(strong.id, job.id).state).toBe("ready");
    expect(store.jobBy(job.id)?.found).toBe(1);
    expect(store.autoReject(nonArtist.id).state).toBe("rejected");
    expect(store.lead({ handle: "brand.page", verdict: "not_artist", confidence: 95, source: { seed: "other", type: "tagged", url: "https://instagram.com/other" }, evidence: [{ kind: "brand", url: "https://instagram.com/brand.page", note: "same brand" }] }).duplicate).toBe(true);
  });

  it("tracks every profile recorded under a research lease", () => {
    const { store } = setup();
    const job = store.job({ name: "Batch", seeds: ["producer"], sources: ["follower"], targetCount: 2 });
    const lease = store.lease("research", null, null, job.id, { targetCount: 2, profileLimit: 10 });
    store.audit(null, "research_inspected", `lease:${lease.id}`);
    store.audit(null, "research_inspected", `lease:${lease.id}`);
    expect(store.researchInspections(lease.id)).toBe(2);
  });
});
