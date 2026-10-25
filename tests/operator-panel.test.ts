import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

const fixtures:Array<{store:Store;dir:string}>=[];
const candidate=(handle:string)=>({handle,verdict:"artist",confidence:90,followers:300,source:{seed:"producer",type:"follower",url:"https://instagram.com/producer"},evidence:[{kind:"release",note:"own song",url:"https://music.example/song"}]});
function setup(){const dir=mkdtempSync(join(tmpdir(),"ebasher-panel-"));const store=new Store(join(dir,"db.sqlite"));fixtures.push({store,dir});return store}
function lead(store:Store,name:string,approve=true){const row=store.lead(candidate(name)).lead;if(approve)store.setLead(row.id,"ready","operator_approve");return row}
afterEach(()=>fixtures.splice(0).forEach(({store,dir})=>{store.close();rmSync(dir,{recursive:true,force:true})}));

describe("client outreach plan",()=>{
  it("searches and pages the full approved CRM beyond the snapshot limit",()=>{
    const s=setup();
    for(let i=0;i<510;i++)lead(s,`artist_${String(i).padStart(3,"0")}`);
    lead(s,"review_only",false);
    expect(s.operatorLeads({state:"ready",limit:100})).toMatchObject({total:510,offset:0,limit:100});
    expect(s.operatorLeads({state:"ready",query:"artist_000"}).leads.map(x=>x.handle)).toEqual(["artist_000"]);
    expect(s.operatorLeads({state:"ready",offset:500,limit:100}).leads).toHaveLength(10);
    expect(s.operatorLeads({state:"review"}).total).toBe(1);
    expect(()=>s.operatorLeads({limit:201})).toThrow("Invalid lead filter");
  });
  it("all-ready selection includes the whole CRM queue and excludes unapproved leads",()=>{
    const s=setup();const a=lead(s,"a.artist"),b=lead(s,"b.artist"),c=lead(s,"c.artist");lead(s,"review.artist",false);
    expect(s.leads(undefined,2)).toHaveLength(2);
    const plan=s.createOperatorCampaign({name:"Batch",body:"Hi @{{handle}}",allReady:true});
    expect(new Set(s.campaignLeads(plan.id).map(x=>x.id))).toEqual(new Set([a.id,b.id,c.id]));
    expect(s.campaignBy(plan.id)?.stats.ready).toBe(3);
  });
  it("rejects mixed selections atomically",()=>{
    const s=setup(),ready=lead(s,"ready.artist"),review=lead(s,"review.artist",false);
    expect(()=>s.createOperatorCampaign({name:"Bad",body:"Hello",leadIds:[ready.id,review.id]})).toThrow("Selected lead is not ready");
    expect(s.campaigns()).toHaveLength(0);expect(s.templates()).toHaveLength(0);
  });
  it("all-ready selection can exclude a specific artist without dropping unseen leads",()=>{
    const s=setup(),a=lead(s,"a.artist"),b=lead(s,"b.artist"),c=lead(s,"c.artist");
    const plan=s.createOperatorCampaign({name:"Except B",body:"Hello",allReady:true,excludedIds:[b.id]});
    expect(new Set(s.campaignLeads(plan.id).map(x=>x.id))).toEqual(new Set([a.id,c.id]));
  });
  it("requires a fresh preview after the message changes",()=>{
    const s=setup(),recipient=lead(s,"preview.artist");
    const plan=s.createOperatorCampaign({name:"Preview",body:"Hi @{{handle}}",leadIds:[recipient.id]});
    const account=s.account("Local");s.heartbeat(account.id,"available","sender");s.campaignState(plan.id,"start");
    expect(s.hasCurrentPreview(plan.id,account.id)).toBe(false);
    const lease=s.outreach(account.id,35,true);expect(lease.payload.target.message).toBe("Hi @preview.artist");
    s.outcome(lease.id,{outcome:"previewed",observedHandle:"preview.artist"});
    expect(s.hasCurrentPreview(plan.id,account.id)).toBe(true);
    expect(s.hasCurrentPreview(plan.id,s.account("Other sender").id)).toBe(false);
    s.audit(null,"mailer_account","activated:another-sender");
    expect(s.hasCurrentPreview(plan.id,account.id)).toBe(false);
    s.campaignState(plan.id,"stop");
    s.replaceCampaignMessage(plan.id,"New message");
    expect(s.hasCurrentPreview(plan.id,account.id)).toBe(false);
    expect(s.campaignBy(plan.id)?.template.body).toBe("New message");
  });
  it("keeps only one campaign running",()=>{
    const s=setup(),a=lead(s,"one.artist"),b=lead(s,"two.artist");
    const one=s.createOperatorCampaign({name:"One",body:"Hi",leadIds:[a.id]});
    const two=s.createOperatorCampaign({name:"Two",body:"Hi",leadIds:[b.id]});
    s.campaignState(one.id,"start");
    expect(()=>s.campaignState(two.id,"start")).toThrow("Stop the other running campaign first");
  });
});
