import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MailerControl } from "../src/mailer-control.js";

const dirs:string[]=[];
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"ebasher-account-switch-"));dirs.push(root);
  mkdirSync(join(root,"mailer","state"),{recursive:true});
  const db=new Database(join(root,"mailer","state","insta-ebasher-v2.db"));
  db.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT, enabled INTEGER, daily_cap INTEGER, cooldown_until TEXT, anty_profile_id TEXT, created_at TEXT, v1_account_id TEXT)");
  const insert=db.prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?)");
  insert.run("one","@one",1,35,null,"local-chrome-one","2026-01-01","v1-one");
  insert.run("two","@two",0,35,null,"local-chrome-two","2026-01-02","v1-two");
  insert.run("other","@other",1,35,null,"anty-profile","2026-01-03",null);
  db.close();return new MailerControl(root,"http://127.0.0.1:3100");
}
afterEach(()=>dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));

describe("local sender switching",()=>{
  it("lists only local Chrome accounts and activates exactly one",()=>{
    const control=fixture();
    expect(control.accounts().map(a=>a.id)).toEqual(["one","two"]);
    expect(control.activateLocalAccount("two").enabled).toBe(true);
    expect(control.accounts().filter(a=>a.enabled).map(a=>a.id)).toEqual(["two"]);
    expect(control.accounts().find(a=>a.enabled)?.v1AccountId).toBe("v1-two");
  });
  it("rejects unknown and non-local accounts without changing selection",()=>{
    const control=fixture();
    expect(()=>control.activateLocalAccount("other")).toThrow("Локальный аккаунт не найден");
    expect(()=>control.activateLocalAccount("missing")).toThrow("Локальный аккаунт не найден");
    expect(control.accounts().filter(a=>a.enabled).map(a=>a.id)).toEqual(["one"]);
  });
});
