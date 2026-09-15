/**
 * Независимая проверка 11 сценариев аудита против ИСХОДНИКА src/store.ts
 * (probe-audit.mjs из аудита гонялся против устаревшего dist/).
 * Запуск: npx tsx scripts/verify-fixes.mts
 */
import { Store } from "../src/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "ie-verify-"));
let s = new Store(join(dir, "data", "app.sqlite"));
const out = (t: string, v: unknown) => console.log(String(t).padEnd(50), v);
let fails = 0;
const check = (cond: boolean, label: string) => { out(label, cond ? "OK ✅" : "FAIL ❌"); if (!cond) fails++; };

let A = s.account("Acc A");
s.heartbeat(A.id, "available", "a.acc");
let B = s.account("Acc B");
s.db.prepare("UPDATE accounts SET enabled=0 WHERE id=?").run(B.id);

let lead = s.lead({ handle: "probe.artist", verdict: "artist", confidence: 90,
  source: { seed: "p", type: "follower", url: "https://instagram.com/p" },
  evidence: [{ kind: "release", url: "https://spotify.com/x", note: "release" }] }).lead.id;
let ready = () => s.setLead(lead, "ready", "approved");

// 1. обычный new_reply без контактов должен уведомлять оператора
let il = s.inboxLease(A.id);
let r = s.inboxEvent({ accountId: A.id, leaseId: il.id, handle: "probe.artist", kind: "new_reply", body: "yo beats fire", receivedAt: new Date().toISOString() }, "+1");
check(r.notification !== null, "1) new_reply без контактов -> notification");
s.done(il.id);

// 2. цифры в тексте НЕ должны распознаваться как телефон
il = s.inboxLease(A.id);
r = s.inboxEvent({ accountId: A.id, leaseId: il.id, handle: "probe.artist", kind: "new_reply", body: "rapping since 2014-2019, hmu", receivedAt: new Date().toISOString() }, "+1");
check(r.event.phone === null, `2) '2014-2019' не телефон (получено: ${r.event.phone})`);
s.done(il.id);

// 3. DNC необратим
s.setLead(lead, "dnc", "operator_dnc");
let dncTerminal = false;
try { ready(); } catch { dncTerminal = true; }
check(dncTerminal, "3) DNC -> ready отклонён");
lead = s.lead({ handle: "probe2.artist", verdict: "artist", confidence: 85,
  source: { seed: "p", type: "follower", url: "https://instagram.com/p" },
  evidence: [{ kind: "release", url: "https://spotify.com/x2", note: "release" }] }).lead.id;

// 4. draft -> running без одобренного шаблона запрещён
const T = s.template({ name: "T", variant: "A", body: "hi @{{handle}}" });
const C = s.campaign({ name: "C", templateId: T.id });
let startBlocked = false;
try { s.campaignState(C.id, "start"); } catch { startBlocked = true; }
check(startBlocked, "4) draft -> running запрещён");

s.approveTemplate(T.id); s.campaignState(C.id, "approve");
ready(); s.addReady(C.id); s.campaignState(C.id, "start");

// 5. dry-run не принимает 'sent'
ready();
let L = s.outreach(A.id, 35, true);
let drySentBlocked = false;
try { s.outcome(L.id, { outcome: "sent", observedHandle: "probe.artist" }); } catch { drySentBlocked = true; }
s.done(L.id);
check(drySentBlocked, "5) dryRun 'sent' отклонён");

// 5b. sent поверх свежего DNC игнорируется
ready();
L = s.outreach(A.id, 35, false);
s.setLead(lead, "dnc", "operator_dnc");
const r5b = s.outcome(L.id, { outcome: "sent", observedHandle: "probe2.artist" });
check(s.leadBy(lead)!.state === "dnc", `5b) sent после DNC не меняет лид (state: ${r5b.state})`);

// новый стор: лид 5b остался в DNC, дальше проверяем на свежем CRM-состоянии
s.close();
s = new Store(join(dir, "data2", "app.sqlite"));
A = s.account("A2");
s.heartbeat(A.id, "available", "a2");
lead = s.lead({ handle: "probe3.artist", verdict: "artist", confidence: 80,
  source: { seed: "p", type: "follower", url: "https://instagram.com/p" },
  evidence: [{ kind: "release", url: "https://spotify.com/x3", note: "release" }] }).lead.id;
const T2 = s.template({ name: "T2", variant: "A", body: "hi @{{handle}}" });
s.approveTemplate(T2.id);
const C2 = s.campaign({ name: "C2", templateId: T2.id });
s.campaignState(C2.id, "approve");
s.setLead(lead, "ready", "approved"); s.addReady(C2.id); s.campaignState(C2.id, "start");
ready = () => s.setLead(lead, "ready", "approved");

B = s.account("Acc B2"); s.db.prepare("UPDATE accounts SET enabled=0 WHERE id=?").run(B.id);

// 6. исход 'banana' отклонён
ready(); L = s.outreach(A.id, 35, false);
let bananaBlocked = false;
try { s.outcome(L.id, { outcome: "banana", observedHandle: "probe.artist" }); } catch { bananaBlocked = true; }
check(bananaBlocked, "6) outcome=\"banana\" отклонён"); s.done(L.id);

// 7. исход по истёкшему lease сохраняется
ready(); L = s.outreach(A.id, 35, false);
s.db.prepare("UPDATE leases SET expires=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), L.id);
let expiredAccepted = false;
try { s.outcome(L.id, { outcome: "not_sent", observedHandle: "probe.artist" }); expiredAccepted = true; } catch {}
check(expiredAccepted, "7) исход по истёкшему lease принимается");

// 8. несовпадение таргета фиксируется, lease закрывается
ready(); L = s.outreach(A.id, 35, false);
const r8 = s.outcome(L.id, { outcome: "target_unavailable", observedHandle: "other.handle" });
const mismatchAudit = s.db.prepare("SELECT detail FROM audit WHERE kind='handle_mismatch' ORDER BY created DESC LIMIT 1").get() as any;
check(mismatchAudit && mismatchAudit.detail === "other.handle", "8) чужой таргет записан как handle_mismatch");

// 9. lease на выключенный аккаунт запрещён
let disabledBlocked = false;
try { s.outreach(B.id, 35, false); } catch (e: any) { disabledBlocked = /disabled/i.test(e.message); }
check(disabledBlocked, "9) lease на выключенный аккаунт запрещён");

// 10. targetCount не уходит в минус после нужного числа одобренных артистов
const J = s.job({ name: "J", seeds: ["p"], sources: ["follower"], targetCount: 2 });
s.audit(null, "agent_auto_approve", "job:" + J.id); s.audit(null, "agent_auto_approve", "job:" + J.id); s.audit(null, "agent_auto_approve", "job:" + J.id);
const J2 = s.jobBy(J.id)!;
let negBlocked = false;
try { s.lease("research", null, null, J.id, { targetCount: Math.min(20, J2.target - J2.found) }); } catch { negBlocked = true; }
check(negBlocked, "10) lease с targetCount<=0 отклонён");

// 11. US-номер без +1: обязательная нормализация к E.164
s.setLead(lead, "contacted", "dm_sent");
il = s.inboxLease(A.id);
r = s.inboxEvent({ accountId: A.id, leaseId: il.id, handle: "probe3.artist", kind: "phone_shared", body: "call 415 555 0100", receivedAt: new Date().toISOString() }, "+1");
check(r.event.phone === "+14155550100", "11) US-номер без +1 нормализован к +1");
s.done(il.id);

s.close();
rmSync(dir, { recursive: true, force: true });
console.log(fails === 0 ? "\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ✅" : `\nПРОВАЛЕНО: ${fails} ❌`);
process.exit(fails === 0 ? 0 : 1);
