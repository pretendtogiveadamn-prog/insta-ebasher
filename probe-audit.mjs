import { Store } from "./dist/src/store.js";

const s = new Store("./data-smoke/audit-probe.sqlite");
const out = (t, v) => console.log(String(t).padEnd(46), v);

const A = s.account("Acc A");
s.heartbeat(A.id, "available", "a.acc");
const B = s.account("Acc B");
s.db.prepare("UPDATE accounts SET enabled=0 WHERE id=?").run(B.id);

let lead = s.lead({ handle: "probe.artist", verdict: "artist", confidence: 90,
  source: { seed: "p", type: "follower", url: "https://instagram.com/p" },
  evidence: [{ url: "https://spotify.com/x", note: "release" }] }).lead.id;
const ready = () => s.setLead(lead, "ready", "approved");

// 1. Обычный ответ без телефона/имейла — уведомление оператору?
let il = s.inboxLease(A.id);
let r = s.inboxEvent({ accountId: A.id, leaseId: il.id, handle: "probe.artist", kind: "new_reply", body: "yo beats fire", receivedAt: new Date().toISOString() }, "+1");
out("1) обычный new_reply -> notification:", r.notification === null ? "NULL — оператор не узнает" : JSON.stringify(r.notification)); s.done(il.id);

// 2. Ложный телефон регексом из любого текста
il = s.inboxLease(A.id);
r = s.inboxEvent({ accountId: A.id, leaseId: il.id, handle: "probe.artist", kind: "new_reply", body: "rapping since 2014-2019, hmu", receivedAt: new Date().toISOString() }, "+1");
out("2) цифры в тексте -> 'phone':", r.event.phone + " | state лида: " + s.leadBy(lead).state); s.done(il.id);

// 3. DNC обратим?
s.setLead(lead, "dnc", "operator_dnc");
out("3) DNC-лид после approve ->", ready().state);

// 4. Кампания draft -> running без одобрения шаблона
const T = s.template({ name: "T", variant: "A", body: "hi @{{handle}}" });
const C = s.campaign({ name: "C", templateId: T.id });
out("4) draft->running, шаблон НЕ одобрен:", s.campaignState(C.id, "running").status);

s.approveTemplate(T.id); s.addReady(C.id);

// 5. dry-run принимает outcome 'sent'
let L = s.outreach(A.id, 35, true);
out("5) dryRun lease -> outcome 'sent' ->", s.outcome(L.id, { outcome: "sent", observedHandle: "probe.artist" }).state);

// 5b. sent поверх свежего DNC (гонка: оператор DNC во время активного lease)
ready();
L = s.outreach(A.id, 35, true);
s.setLead(lead, "dnc", "operator_dnc");
out("5b) DNC во время lease -> outcome sent ->", s.outcome(L.id, { outcome: "sent", observedHandle: "probe.artist" }).state);

// 6. Валидация значения outcome
ready(); L = s.outreach(A.id, 35, true);
try { s.outcome(L.id, { outcome: "banana", observedHandle: "probe.artist" }); out("6) outcome='banana':", "ПРИНЯТ, lease закрыт"); }
catch (e) { out("6) outcome='banana':", "отклонён: " + e.message); }

// 7. Исход по истёкшему lease (факт теряется)
ready(); L = s.outreach(A.id, 35, true);
s.db.prepare("UPDATE leases SET expires=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), L.id);
try { s.outcome(L.id, { outcome: "sent", observedHandle: "probe.artist" }); out("7) исход по истёкшему lease:", "принят"); }
catch (e) { out("7) исход по истёкшему lease:", e.message + " | лид остался: " + s.leadBy(lead).state); }

// 8. Отчёт о несовпадении таргета
ready(); L = s.outreach(A.id, 35, true);
try { s.outcome(L.id, { outcome: "target_unavailable", observedHandle: "other.handle" }); }
catch (e) { out("8) отчёт о чужом таргете:", e.message + " | lease завис active до expiry"); }
s.done(L.id);

// 9. Lease на выключенный аккаунт
L = s.outreach(B.id, 35, true);
out("9) lease на ВЫКЛЮЧЕННЫЙ аккаунт:", "выдан, account_id=" + L.payload.target.handle + " / " + L.type);
s.done(L.id);

// 10. Отрицательный targetCount ресёрч-lease
const J = s.job({ name: "J", seeds: ["p"], sources: ["follower"], targetCount: 2 });
s.audit(null, "found", "job:" + J.id); s.audit(null, "found", "job:" + J.id); s.audit(null, "found", "job:" + J.id);
const J2 = s.jobBy(J.id);
out("10) target=2, found=3 -> targetCount:", Math.min(20, J2.target - J2.found));

// 11. Российский номер нормализуется как +1
il = s.inboxLease(A.id);
r = s.inboxEvent({ accountId: A.id, leaseId: il.id, handle: "probe.artist", kind: "phone_shared", body: "пиши 8 912 123 45 67", receivedAt: new Date().toISOString() }, "+1");
out("11) '8 912 123 45 67' ->", r.event.phone + " (неверно)"); s.done(il.id);

s.close();
