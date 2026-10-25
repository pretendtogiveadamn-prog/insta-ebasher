import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

type MailerAccount = { id:string; username:string|null; enabled:boolean; dailyCap:number; cooldownUntil:string|null; profile:string; v1AccountId:string|null };
type RunState = { state:"idle"|"running"|"stopping"|"finished"|"failed"; accountId:string|null; campaignId:string|null; dryRun:boolean; max:number; startedAt:string|null; finishedAt:string|null; exitCode:number|null; lines:string[] };

export class MailerControl {
  private child:ChildProcess|null=null;
  private run:RunState={state:"idle",accountId:null,campaignId:null,dryRun:true,max:0,startedAt:null,finishedAt:null,exitCode:null,lines:[]};
  private readonly dir:string;
  private readonly dbPath:string;
  constructor(root:string,private readonly baseUrl:string,private readonly onChange:()=>void=()=>{},mailerDir=join(root,"mailer")){
    this.dir=mailerDir;
    this.dbPath=join(this.dir,"state","insta-ebasher-v2.db");
  }
  accounts():MailerAccount[]{
    if(!existsSync(this.dbPath))return [];
    const db=new Database(this.dbPath,{readonly:true,fileMustExist:true});
    try{
      const hasV1=(db.pragma("table_info(accounts)") as {name:string}[]).some(column=>column.name==="v1_account_id");
      const v1Column=hasV1?"v1_account_id":"NULL AS v1_account_id";
      return (db.prepare(`SELECT id,username,enabled,daily_cap,cooldown_until,anty_profile_id,${v1Column} FROM accounts WHERE anty_profile_id LIKE 'local-chrome%' ORDER BY created_at`).all() as any[]).map(a=>({id:a.id,username:a.username,enabled:!!a.enabled,dailyCap:a.daily_cap,cooldownUntil:a.cooldown_until,profile:a.anty_profile_id,v1AccountId:a.v1_account_id}));
    }
    finally{db.close()}
  }
  activateLocalAccount(id:string){
    if(this.child)throw Error("Сначала остановите текущую рассылку");
    if(!this.accounts().some(a=>a.id===id))throw Error("Локальный аккаунт не найден");
    const db=new Database(this.dbPath);
    try{db.transaction(()=>db.prepare("UPDATE accounts SET enabled=CASE WHEN id=? THEN 1 ELSE 0 END WHERE anty_profile_id LIKE 'local-chrome%'").run(id))();}
    finally{db.close()}
    this.onChange();
    return this.accounts().find(a=>a.id===id)!;
  }
  addLocalAccount(username:string){
    const name=username.trim().replace(/^@/,"").toLowerCase();
    if(!/^[a-z0-9._]{1,30}$/.test(name))throw Error("Введите корректный Instagram username");
    if(this.accounts().some(a=>a.username?.replace(/^@/,"").toLowerCase()===name))throw Error("Этот аккаунт уже добавлен");
    if(this.child)throw Error("Сначала остановите текущую рассылку");
    if(!existsSync(join(this.dir,"node_modules","playwright-core")))throw Error("Сначала установите зависимости mailer: npm install в папке mailer");
    const result=spawnSync(process.execPath,["run.mjs","accounts","add","--anty-profile",`local-chrome-${name}`,"--username",`@${name}`,"--cap","35"],{cwd:this.dir,encoding:"utf8",timeout:10000,env:{...process.env,ANTY_TOKEN:"",IH_CLASSIFY_ONLY:"1"}});
    if(result.error||result.status!==0)throw Error(`Не удалось добавить аккаунт: ${result.error?.message||result.stderr?.slice(0,160)||result.stdout?.slice(0,160)||"CLI error"}`);
    const added=this.accounts().find(a=>a.username?.replace(/^@/,"").toLowerCase()===name);
    if(!added)throw Error("Аккаунт не появился после добавления");
    return this.activateLocalAccount(added.id);
  }
  status(){return {...this.run,lines:[...this.run.lines]}}
  private line(chunk:Buffer|string){
    const clean=String(chunk).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").split(/\r?\n/).filter(Boolean);
    this.run.lines.push(...clean.map(x=>x.slice(0,300)));
    this.run.lines=this.run.lines.slice(-30);
    this.onChange();
  }
  start(input:{accountId:string;campaignId:string;max:number;dryRun:boolean}){
    if(this.child)throw Error("Рассылка уже выполняется");
    const account=this.accounts().find(a=>a.id===input.accountId);
    if(!account||!account.enabled)throw Error("Выберите включённый Instagram-аккаунт");
    if(!account.profile?.startsWith("local-chrome"))throw Error("В панели поддерживается только локальный Chrome клиента");
    if(account.cooldownUntil&&Date.parse(account.cooldownUntil)>Date.now())throw Error("Аккаунт на паузе до "+account.cooldownUntil);
    if(!Number.isInteger(input.max)||input.max<1||input.max>35)throw Error("Размер партии: от 1 до 35");
    if(!existsSync(join(this.dir,"node_modules","playwright-core")))throw Error("Сначала установите зависимости mailer: npm install в папке mailer");
    const args=["run.mjs","mail","--v1",this.baseUrl,"--account",account.id,"--max",String(input.max)];
    if(input.dryRun)args.push("--dry-run");
    const child=spawn(process.execPath,args,{cwd:this.dir,env:{...process.env,ANTY_TOKEN:"",IH_CLASSIFY_ONLY:input.dryRun?"1":"0"},stdio:["ignore","pipe","pipe"],windowsHide:true});
    this.child=child;
    this.run={state:"running",accountId:account.id,campaignId:input.campaignId,dryRun:input.dryRun,max:input.max,startedAt:new Date().toISOString(),finishedAt:null,exitCode:null,lines:[]};
    child.stdout?.on("data",x=>this.line(x));child.stderr?.on("data",x=>this.line(x));
    child.on("error",e=>{this.line(`Ошибка запуска: ${e.message}`);this.run.state="failed";this.child=null;this.run.finishedAt=new Date().toISOString();this.onChange()});
    child.on("exit",code=>{this.child=null;this.run.exitCode=code;this.run.finishedAt=new Date().toISOString();this.run.state=code===0?"finished":"failed";this.onChange()});
    this.onChange();
    return this.status();
  }
  requestStop(){if(this.child){this.run.state="stopping";this.onChange()}return this.status()}
}
