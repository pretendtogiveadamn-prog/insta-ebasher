import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";

const clean: Array<{ store: Store; dir: string }> = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "insta-ebasher-audit14-")); const store = new Store(join(dir, "data", "app.sqlite")); clean.push({ store, dir });
  const account = store.account("IG"); store.heartbeat(account.id, "available", "ig.account");
  const lead = store.lead({ handle: "audit.artist", verdict: "artist", confidence: 90, source: { seed: "p", type: "follower", url: "https://instagram.com/p" }, evidence: [{ kind: "release", url: "https://spotify.com/a", note: "release" }] }).lead;
  store.setLead(lead.id, "ready", "approved");
  const template = store.template({ name: "T", variant: "A", body: "Hi {{handle}}" }); store.approveTemplate(template.id);
  const campaign = store.campaign({ name: "C", templateId: template.id }); store.addReady(campaign.id); store.campaignState(campaign.id, "approve"); store.campaignState(campaign.id, "start");
  return { store, account, lead };
}
afterEach(() => clean.splice(0).forEach(({ store, dir }) => { store.close(); rmSync(dir, { recursive: true, force: true }); }));

describe("AUDIT_2026-09-14 regressions", () => {
  it("fails closed after an abandoned outreach lease instead of leasing the same lead again", () => {
    const { store, account, lead } = setup();
    const first = store.outreach(account.id, 35, false);
    store.db.prepare("UPDATE leases SET expires=? WHERE id=?").run(new Date(Date.now() - 1_000).toISOString(), first.id);
    expect(() => store.outreach(account.id, 35, false)).toThrow("No eligible lead");
    expect(store.leadBy(lead.id)?.state).toBe("unknown");
  });

  it("records inbox facts and alert atomically when a reply cannot advance the CRM state", () => {
    const { store, account, lead } = setup();
    const lease = store.inboxLease(account.id);
    const result = store.inboxEvent({ accountId: account.id, leaseId: lease.id, handle: lead.handle, kind: "phone_shared", phoneRaw: "+1 415 555 0100", body: "call me", receivedAt: new Date().toISOString() }, "+1");
    expect(result.duplicate).toBe(false);
    expect(result.notification?.text).toContain("телефон");
    expect(store.db.prepare("SELECT COUNT(*) n FROM inbox").get()).toMatchObject({ n: 1 });
    expect(store.db.prepare("SELECT COUNT(*) n FROM notifications").get()).toMatchObject({ n: 1 });
    expect(store.leadBy(lead.id)?.state).toBe("ready");
  });

  it("rejects inbox work when Chrome heartbeat is stale", () => {
    const { store, account } = setup();
    store.db.prepare("UPDATE accounts SET heartbeat=? WHERE id=?").run(new Date(Date.now() - 91_000).toISOString(), account.id);
    expect(() => store.inboxLease(account.id)).toThrow("Chrome MCP is not ready");
  });

  it("revokes an already-issued live lease when the operator disables sending", () => {
    const { store, account } = setup();
    const lease = store.outreach(account.id, 35, false);
    expect(store.revokeLiveOutreachLeases()).toBe(1);
    expect(() => store.outcome(lease.id, { outcome: "sent", observedHandle: "audit.artist" })).toThrow("Lease is unknown or expired");
  });
});
