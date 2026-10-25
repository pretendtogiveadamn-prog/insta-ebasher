#!/usr/bin/env node
// Local client-control CLI. All mutations go through the same API as the panel.
import { readFile } from "node:fs/promises";

const base=new URL(process.env.IH_PANEL_URL||"http://127.0.0.1:3100");
if(!["127.0.0.1","localhost","::1"].includes(base.hostname)||!(["http:","https:"].includes(base.protocol)))throw Error("IH_PANEL_URL must point to the local panel");
const usage=`Usage: npm run outreach -- <command>
  status
  leads [--state ready|review|all] [--query handle] [--offset N] [--limit N]
  accounts
  account add @username | account use <id-or-@username>
  campaigns | campaign leads <id>
  campaign create --name "Name" --message-file <path> (--all-ready | --lead <id>...) [--exclude <id>...]
  campaign message <id> --message-file <path>
  preview <campaign-id> | allow --confirm SEND_REAL_MESSAGES
  send <campaign-id> [--max N] | stop | disable

All commands require the local panel to be running. Live sending also requires a successful
preview for the selected account and an explicit 'allow' command. No command bypasses server gates.`;

function options(args){
  const out={_:[]};
  for(let i=0;i<args.length;i++){
    const part=args[i];
    if(!part.startsWith("--")){out._.push(part);continue}
    const key=part.slice(2);
    if(key==="all-ready"){out[key]=true;continue}
    const value=args[++i];
    if(value===undefined||value.startsWith("--"))throw Error(`Missing value for --${key}`);
    if(["lead","exclude"].includes(key))(out[key]??=[]).push(value);else out[key]=value;
  }
  return out;
}
async function api(path,method="GET",body){
  const response=await fetch(new URL(`/api${path}`,base),{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
  if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
  return data;
}
const show=value=>console.log(JSON.stringify(value,null,2));
async function activeAccount(){
  const mailer=await api("/operator/mailer");
  const account=mailer.accounts.find(a=>a.enabled);
  if(!account)throw Error("No active sender. Run: account add @username or account use <id>");
  return account;
}
async function resolveAccount(value){
  const accounts=(await api("/operator/mailer")).accounts;
  const key=value.replace(/^@/,"").toLowerCase();
  const found=accounts.find(a=>a.id===value||a.username?.replace(/^@/,"").toLowerCase()===key);
  if(!found)throw Error("Account not found. Run: accounts");
  return found;
}
async function message(path){
  if(!path)throw Error("--message-file is required");
  const body=(await readFile(path,"utf8")).trim();
  if(!body)throw Error("Message file is empty");
  return body;
}
async function main(){
  const [command,...args]=process.argv.slice(2),opt=options(args);
  if(!command||["help","--help","-h"].includes(command)){console.log(usage);return}
  if(command==="status"){
    const [snapshot,mailer]=await Promise.all([api("/panel/snapshot"),api("/operator/mailer")]);
    show({mode:snapshot.state.mode,quota:snapshot.state.quota,activeCampaignId:snapshot.state.activeCampaignId,activeAccount:mailer.accounts.find(a=>a.enabled)||null,chromeReady:mailer.chromeReady,run:mailer.run});return;
  }
  if(command==="leads"){
    const q=new URLSearchParams({state:opt.state||"ready",query:opt.query||"",offset:opt.offset||"0",limit:opt.limit||"100"});
    show(await api(`/operator/leads?${q}`));return;
  }
  if(command==="accounts"){show((await api("/operator/mailer")).accounts);return}
  if(command==="account"){
    const [action,value]=opt._;
    if(!value)throw Error(usage);
    if(action==="add"){show(await api("/operator/mailer/accounts","POST",{username:value}));return}
    if(action==="use"){const account=await resolveAccount(value);show(await api(`/operator/mailer/accounts/${encodeURIComponent(account.id)}/activate`,"POST"));return}
  }
  if(command==="campaigns"){show((await api("/panel/snapshot")).campaigns);return}
  if(command==="campaign"){
    const [action,id]=opt._;
    if(action==="leads"&&id){const account=(await api("/operator/mailer")).accounts.find(a=>a.enabled);show(await api(`/operator/plans/${encodeURIComponent(id)}/leads?accountId=${encodeURIComponent(account?.id||"")}`));return}
    if(action==="create"){
      if(!opt.name||(!opt["all-ready"]&&!opt.lead?.length))throw Error("Specify --name and either --all-ready or --lead <id>");
      const plan=await api("/operator/plans","POST",{name:opt.name,body:await message(opt["message-file"]),allReady:!!opt["all-ready"],leadIds:opt.lead||[],excludedIds:opt.exclude||[]});
      show({id:plan.id,name:plan.name,status:plan.status,stats:plan.stats});return;
    }
    if(action==="message"&&id){show(await api(`/operator/plans/${encodeURIComponent(id)}/message`,"PATCH",{body:await message(opt["message-file"])}));return}
  }
  if(command==="preview"&&opt._[0]){const account=await activeAccount();show(await api("/operator/mailer/start","POST",{campaignId:opt._[0],accountId:account.id,max:1,dryRun:true}));return}
  if(command==="allow"){show(await api("/runtime/enable-real-sending","POST",{confirmation:opt.confirm}));return}
  if(command==="send"&&opt._[0]){
    const account=await activeAccount();
    const detail=await api(`/operator/plans/${encodeURIComponent(opt._[0])}/leads?accountId=${encodeURIComponent(account.id)}`);
    const remaining=(await api("/agent/state")).quota.firstDmRemaining;
    const max=opt.max===undefined?Math.min(35,remaining,detail.leads.filter(x=>x.state==="ready").length):Number(opt.max);
    show(await api("/operator/mailer/start","POST",{campaignId:opt._[0],accountId:account.id,max,dryRun:false}));return;
  }
  if(command==="stop"){show(await api("/operator/mailer/stop","POST"));return}
  if(command==="disable"){
    const run=(await api("/operator/mailer")).run;
    if(["running","stopping"].includes(run.state)){show(await api("/operator/mailer/stop","POST"));return}
    show(await api("/runtime/disable-real-sending","POST"));return;
  }
  throw Error(usage);
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
