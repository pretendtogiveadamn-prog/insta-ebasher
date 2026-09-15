import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { backup, verifyBackupManifest } from "../src/backup.js";

const clean:Array<{s:Store;d:string}>=[];
function fixture(){const d=mkdtempSync(join(tmpdir(),"insta-ebasher-bak-")),s=new Store(join(d,"data","app.sqlite"));clean.push({s,d});return{s,dbPath:join(d,"data","app.sqlite")}}
afterEach(()=>clean.splice(0).forEach(({s,d})=>{s.close();rmSync(d,{recursive:true,force:true})}));

describe("backup",()=>{
 it("creates a restorable copy with matching rows and a valid manifest",async()=>{
   const{s,dbPath}=fixture();
   s.lead({handle:"bak.one",verdict:"artist",confidence:90,source:{seed:"p",type:"follower",url:"https://instagram.com/p"},evidence:[{kind:"release",url:"https://spotify.com/x",note:"release"}]});
   s.lead({handle:"bak.two",verdict:"artist",confidence:80,source:{seed:"p",type:"follower",url:"https://instagram.com/p"},evidence:[{kind:"release",url:"https://spotify.com/y",note:"release"}]});
   const r=await backup(dbPath,join(dbPath,".."));
   const files=readdirSync(r.dir);expect(files).toContain("manifest.json");expect(files).toContain("app.sqlite");
   const copy=new (await import("better-sqlite3")).default(join(r.dir,"app.sqlite"),{readonly:true});
   expect((copy.prepare("SELECT COUNT(*) n FROM leads").get() as any).n).toBe(2);
   expect(copy.pragma("integrity_check",{simple:true})).toBe("ok");
   copy.close();
   expect(files.filter(f=>f.endsWith("-wal")||f.endsWith("-shm")).every(f=>f.includes(".tmp"))).toBe(true);
   const m=verifyBackupManifest(r.dir);
   expect(m.counts.leads).toBe(2);expect(m.secretsIncluded).toBe(false)
 });
 it("refuses a missing database",async()=>{await expect(backup(join(tmpdir(),"nope-"+Date.now()+".sqlite"),tmpdir())).rejects.toThrow("Database does not exist")});
});
