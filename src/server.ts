import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { Events } from "./events.js";
import { Store } from "./store.js";
import { MailerControl } from "./mailer-control.js";

const c = config();
const store = new Store(c.db);
const events = new Events();
let dry = c.dryRun;
let limit = store.dailyLimit(c.limit);
const app = express();
app.use(express.json({ limit: "2mb" }));
const moduleDir=dirname(fileURLToPath(import.meta.url));
const root=existsSync(join(moduleDir,"..","public"))?join(moduleDir,".."):join(moduleDir,"..","..");
app.use(express.static(join(root,"public")));
const changed = () => events.emit();
const mailer=new MailerControl(root,`http://${c.host==="::1"?"[::1]":c.host}:${c.port}`,()=>{
  const status=mailer.status();
  if(status.state==="finished"||status.state==="failed"){
    if(status.campaignId&&store.campaignBy(status.campaignId)?.status==="running")store.campaignState(status.campaignId,"stop");
    if(!dry){dry=true;store.audit(null,"runtime","real_sending_auto_disabled_after_worker");}
  }
  changed();
});
const obj = (value: any) => { if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("JSON object is required"); return value; };

async function notify(notification: any) {
  if (!notification) return;
  if (!c.telegram.token || !c.telegram.chatId) { store.finishNote(notification.id, "not_configured", "Telegram is not configured"); return; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${c.telegram.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ chat_id: c.telegram.chatId, text: notification.text }) });
    if (!response.ok) throw Error(`Telegram ${response.status}`);
    store.finishNote(notification.id, "sent", null);
  } catch (error) { store.finishNote(notification.id, "pending", error instanceof Error ? error.message : "Telegram failed"); }
  finally { clearTimeout(timer); }
}

app.get("/api/health", (_q, res) => res.json({ ok: true, product: "INSTA-EBASHER" }));
app.get("/api/panel/snapshot", (_q, res) => res.json(store.snapshot(limit, dry)));
app.get("/api/agent/state", (_q, res) => res.json(store.state(limit, dry)));
app.get("/api/panel/events", (request, response) => {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  response.write("event: ready\ndata: {}\n\n");
  const off = events.on(() => response.write("event: state\ndata: {}\n\n"));
  request.on("close", off);
});

app.post("/api/accounts", (req, res) => { const account = store.account(obj(req.body).label); store.audit(null, "account", `created:${account.label}`); changed(); res.status(201).json(account); });
app.post("/api/agent/heartbeat", (req, res) => { const body = obj(req.body); const account = store.heartbeat(body.accountId, body.chromeState, body.username ?? null); changed(); res.json({ account, state: store.state(limit, dry) }); });
app.post("/api/accounts/:id/:mode", (req, res) => {
  if (!(["pause", "resume"] as string[]).includes(req.params.mode)) throw Error("Invalid account action");
  const account = store.accountBy(req.params.id); if (!account) throw Error("Account not found");
  store.db.prepare("UPDATE accounts SET enabled=? WHERE id=?").run(req.params.mode === "resume" ? 1 : 0, account.id);
  store.audit(null, "account", `${req.params.mode}:${account.id}`); changed(); res.json(store.accountBy(account.id));
});

app.post("/api/research/jobs", (req, res) => { const job = store.job(obj(req.body)); changed(); res.status(201).json(job); });
app.get("/api/research/jobs", (_q, res) => res.json(store.jobs()));
app.post("/api/research/jobs/:id/stop", (req, res) => { if (!store.jobBy(req.params.id)) throw Error("Research job not found"); store.db.prepare("UPDATE jobs SET status='stopped' WHERE id=?").run(req.params.id); store.audit(null, "research_job", `stopped:${req.params.id}`); changed(); res.json(store.jobBy(req.params.id)); });
app.post("/api/agent/research-jobs/:id/leases", (req, res) => { const job = store.jobBy(req.params.id); if (!job || job.status !== "running") throw Error("Research job is not running"); const targetCount = Math.min(20, job.target - job.found); const lease = store.lease("research", null, null, job.id, { ...job.brief, targetCount, foundAtGrant: job.found, profileLimit: Math.min(60, Math.max(10, targetCount * 4)) }); changed(); res.status(201).json(lease); });
app.post("/api/agent/research-leases/:id/complete", (req, res) => { store.leaseBy(req.params.id, "research"); store.done(req.params.id); changed(); res.json({ ok: true }); });
const candidate = (req: any, res: any) => { const body = obj(req.body); if (typeof body.jobId !== "string" || typeof body.leaseId !== "string") throw Error("jobId and leaseId are required"); const lease = store.leaseBy(body.leaseId, "research"); if (lease.job_id !== body.jobId) throw Error("Research lease does not match jobId"); const job = store.jobBy(body.jobId); if (!job || job.status !== "running") throw Error("Research job is not running"); const scope = JSON.parse(lease.payload); if (!scope.seeds?.includes(body.source?.seed) || !scope.sources?.includes(body.source?.type)) throw Error("Candidate is outside the research lease scope"); if (store.researchInspections(lease.id) >= Number(scope.profileLimit)) throw Error("Research profile limit reached"); if (job.found >= job.target || job.found - Number(scope.foundAtGrant ?? 0) >= Number(scope.targetCount)) throw Error("Research lease target reached"); const result = store.lead(body); store.audit(result.lead.id, "research_inspected", `lease:${lease.id}`); changed(); res.status(result.duplicate ? 200 : 201).json(result); };
app.post("/api/agent/candidates", candidate); app.post("/api/agent/research-candidates", candidate);
app.get("/api/research/leads", (req, res) => res.json(store.leads(req.query.state as string | undefined)));
app.post("/api/research/leads/:id/:decision", (req, res) => { const d = req.params.decision; const state = d === "approve" || d === "unblock" ? "ready" : d === "reject" ? "rejected" : d === "dnc" ? "dnc" : null; if (!state) throw Error("Invalid decision"); const lead = store.setLead(req.params.id, state as any, `operator_${d}`); changed(); res.json(lead); });
app.post("/api/agent/research-leads/:id/approve", (req, res) => { const body = obj(req.body); if (typeof body.jobId !== "string" || typeof body.leaseId !== "string") throw Error("jobId and leaseId are required"); const lease = store.leaseBy(body.leaseId, "research"); if (lease.job_id !== body.jobId) throw Error("Research lease does not match jobId"); const job = store.jobBy(body.jobId); if (!job || job.status !== "running") throw Error("Research job is not running"); const approved = store.autoApprove(req.params.id, job.id); const current = store.jobBy(job.id); if (current && current.found >= current.target) { store.db.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(current.id); store.audit(null, "research_job", `completed:${current.id}`); } changed(); res.json(approved); });
app.post("/api/agent/research-leads/:id/reject", (req, res) => { const rejected = store.autoReject(req.params.id); changed(); res.json(rejected); });

app.get("/api/templates", (_q, res) => res.json(store.templates()));
app.post("/api/templates", (req, res) => { const template = store.template(obj(req.body)); store.audit(null, "template", "created"); changed(); res.status(201).json(template); });
app.post("/api/templates/:id/approve", (req, res) => { const template = store.approveTemplate(req.params.id); changed(); res.json(template); });
app.get("/api/campaigns", (_q, res) => res.json(store.campaigns()));
app.post("/api/campaigns", (req, res) => { const campaign = store.campaign(obj(req.body)); changed(); res.status(201).json(campaign); });
app.post("/api/campaigns/:id/add-approved-leads", (req, res) => { const added = store.addReady(req.params.id); changed(); res.json({ added }); });
app.post("/api/campaigns/:id/leads", (req, res) => { const added = store.addLeads(req.params.id, obj(req.body).leadIds); changed(); res.json({ added }); });
app.post("/api/campaigns/:id/:action", (req, res) => { if (!(["approve", "start", "stop"] as string[]).includes(req.params.action)) throw Error("Invalid campaign action"); const campaign = store.campaignState(req.params.id, req.params.action as any); changed(); res.json(campaign); });
app.get("/api/operator/mailer",async(_req,res)=>{
  let chromeReady=false;
  try{const result=await fetch("http://127.0.0.1:9222/json/version",{signal:AbortSignal.timeout(1500)});chromeReady=result.ok}catch{}
  res.json({accounts:mailer.accounts(),run:mailer.status(),chromeReady});
});
app.post("/api/operator/mailer/accounts",(req,res)=>{const account=mailer.addLocalAccount(obj(req.body).username);store.audit(null,"mailer_account",`created:${account.id}`);changed();res.status(201).json(account)});
app.post("/api/operator/plans",(req,res)=>{const plan=store.createOperatorCampaign(obj(req.body));changed();res.status(201).json({...plan,leads:store.campaignLeads(plan.id)})});
app.get("/api/operator/plans/:id/leads",(req,res)=>res.json({leads:store.campaignLeads(req.params.id),hasPreview:store.hasCurrentPreview(req.params.id,String(req.query.accountId||""))}));
app.patch("/api/operator/plans/:id/message",(req,res)=>{const plan=store.replaceCampaignMessage(req.params.id,obj(req.body).body);changed();res.json(plan)});
app.post("/api/operator/mailer/start",async(req,res)=>{
  const body=obj(req.body);
  if(typeof body.campaignId!=="string"||typeof body.accountId!=="string"||typeof body.dryRun!=="boolean"||!Number.isInteger(body.max))throw Error("Выберите кампанию, аккаунт и размер партии");
  const campaign=store.campaignBy(body.campaignId);
  if(!campaign||!["approved","stopped","running"].includes(campaign.status))throw Error("Кампания не готова к запуску");
  if(campaign.status==="running"&&store.state(limit,dry).activeCampaignId!==campaign.id)throw Error("Сначала остановите другую кампанию");
  const ready=store.campaignLeads(campaign.id).filter(x=>x.state==="ready").length;
  if(!ready)throw Error("В кампании нет получателей, готовых к отправке");
  const remaining=store.state(limit,dry).quota.firstDmRemaining;
  if(!remaining)throw Error("Суточный лимит первых сообщений исчерпан");
  if(body.max<1||body.max>Math.min(35,ready,remaining))throw Error(`Размер партии: от 1 до ${Math.min(35,ready,remaining)}`);
  if(!body.dryRun&&dry)throw Error("Включите реальную отправку перед запуском");
  if(!body.dryRun&&!store.hasCurrentPreview(campaign.id,body.accountId))throw Error("Сначала проверьте эту версию сообщения с выбранным аккаунтом");
  if(store.state(limit,dry).activeLease)throw Error("Дождитесь завершения текущего действия");
  const chrome=await fetch("http://127.0.0.1:9222/json/version",{signal:AbortSignal.timeout(1500)}).catch(()=>null);
  if(!chrome?.ok)throw Error("Chrome для рассылки не открыт. Запустите mailer/start-chrome.bat и войдите в Instagram");
  const wasRunning=campaign.status==="running";
  if(!wasRunning)store.campaignState(campaign.id,"start");
  try{const run=mailer.start({accountId:body.accountId,campaignId:campaign.id,max:body.max,dryRun:body.dryRun});store.audit(null,"mailer_run",`started:${campaign.id};dry=${body.dryRun};max=${body.max}`);changed();res.status(201).json(run)}
  catch(error){if(!wasRunning)store.campaignState(campaign.id,"stop");throw error}
});
app.post("/api/operator/mailer/stop",(_req,res)=>{
  const run=mailer.status();
  if(run.campaignId){const campaign=store.campaignBy(run.campaignId);if(campaign?.status==="running")store.campaignState(campaign.id,"stop")}
  store.audit(null,"mailer_run","stop_requested");changed();res.json(mailer.requestStop());
});
app.post("/api/runtime/enable-real-sending", (req, res) => { if (obj(req.body).confirmation !== "SEND_REAL_MESSAGES") throw Error("Invalid confirmation"); dry = false; store.audit(null, "runtime", "real_sending_enabled"); changed(); res.json(store.state(limit, dry)); });
app.post("/api/runtime/disable-real-sending", (_req, res) => { dry = true; const revoked = store.revokeLiveOutreachLeases(); store.audit(null, "runtime", `real_sending_disabled;revoked=${revoked}`); changed(); res.json({ ...store.state(limit, dry), revoked }); });
app.post("/api/runtime/daily-limit", (req, res) => { limit = store.setDailyLimit(obj(req.body).limit); changed(); res.json(store.state(limit, dry)); });

app.post("/api/agent/outreach-leases", (req, res) => { const lease = store.outreach(obj(req.body).accountId, limit, dry); changed(); res.status(201).json(lease); });
app.post("/api/agent/outreach-leases/:id/outcome", (req, res) => { const lead = store.outcome(req.params.id, obj(req.body)); changed(); res.json(lead); });
app.post("/api/agent/inbox-leases", (req, res) => { const lease = store.inboxLease(obj(req.body).accountId); changed(); res.status(201).json(lease); });
app.post("/api/agent/inbox-events", async (req, res) => { const result = store.inboxEvent(obj(req.body), c.country); await notify(result.notification); changed(); res.status(result.duplicate ? 200 : 201).json(result); });
app.post("/api/agent/inbox-leases/:id/complete", (req, res) => { store.leaseBy(req.params.id, "inbox"); store.done(req.params.id); changed(); res.json({ ok: true }); });
app.post("/api/notifications/:id/retry", async (req, res) => { const notification = store.noteById(req.params.id); if (!notification) throw Error("Notification not found"); await notify(notification); changed(); res.json(store.noteById(req.params.id)); });

app.use((error: any, _req: any, res: any, _next: any) => { const message=error instanceof Error?error.message:"Request failed"; const internal=/sqlite|sql(?:ite)?|constraint|syntax|stack|better-sqlite/i.test(message); res.status(/not found/i.test(message)?404:internal?500:400).json({ error:internal?"Request could not be completed":message }); });
const server = app.listen(c.port, c.host, () => console.log(`INSTA-EBASHER on ${c.host}:${c.port}`));
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const run = mailer.status();
  if (run.state === "running" || run.state === "stopping") {
    if (run.campaignId && store.campaignBy(run.campaignId)?.status === "running") store.campaignState(run.campaignId, "stop");
    mailer.requestStop();
  }
  const finish = () => {
    if (["running", "stopping"].includes(mailer.status().state)) { setTimeout(finish, 1000); return; }
    server.close(() => { store.close(); process.exit(0); });
    server.closeAllConnections();
  };
  finish();
};
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
