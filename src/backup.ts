import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";

const WAL_SUFFIXES = ["-wal", "-shm"];
const MANIFEST_VERSION = 1;
const COUNTED_TABLES = ["accounts","leads","jobs","templates","campaigns","memberships","leases","inbox","notifications","audit","blocklist","settings"];

export type BackupResult = { dir:string; target:string; sha:string; counts:Record<string,number>; schemaVersion:string };

export async function backup(databasePath:string,dataDir:string){
  if(!existsSync(databasePath))throw Error("Database does not exist");
  const probe=new Database(databasePath,{readonly:true});
  try{
    if(probe.pragma("integrity_check",{simple:true})!=="ok")throw Error("SQLite integrity check failed");
  }finally{probe.close()}
  const dir=join(dataDir,"backups",new Date().toISOString().replace(/[:.]/g,"-"));
  const tmpDir=dir+".tmp";mkdirSync(tmpDir,{recursive:true});
  try{
    const target=join(tmpDir,basename(databasePath));
    const db=new Database(databasePath,{readonly:true});
    try{await db.backup(target)}finally{db.close()}
    const check=new Database(target,{readonly:true});let counts:Record<string,number>;
    try{if(check.pragma("integrity_check",{simple:true})!=="ok")throw Error("Backup integrity check failed");counts={};for(const t of COUNTED_TABLES)counts[t]=Number((check.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n)}finally{check.close()}
    const sha=await new Promise<string>((ok,bad)=>{const h=createHash("sha256");createReadStream(target).on("data",x=>h.update(x)).on("end",()=>ok(h.digest("hex"))).on("error",bad)});
    const sv=new Database(target,{readonly:true});const schemaVersion=String(sv.pragma("user_version",{simple:true})??0);sv.close();
    const manifest={version:MANIFEST_VERSION,database:basename(target),sha256:sha,counts,schemaVersion,profilesIncluded:false,secretsIncluded:false,createdAt:new Date().toISOString()};
    writeFileSync(join(tmpDir,"manifest.json"),JSON.stringify(manifest,null,2));
    cpSync(tmpDir,dir,{recursive:true});
    for(const s of WAL_SUFFIXES)rmSync(join(dir,basename(databasePath)+s),{force:true,maxRetries:5,retryDelay:120});
    rmSync(tmpDir,{recursive:true,force:true,maxRetries:5,retryDelay:120});
    return{dir,target:join(dir,basename(databasePath)),sha,counts,schemaVersion}
  }catch(e){try{rmSync(tmpDir,{recursive:true,force:true,maxRetries:5,retryDelay:120})}catch{};throw e}
}

export function verifyBackupManifest(dir:string){
  const m=JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8")) as {database:string;sha256:string;counts:Record<string,number>;secretsIncluded:boolean;schemaVersion:string};
  const dbFile=join(dir,m.database);
  const sha=createHash("sha256").update(readFileSync(dbFile)).digest("hex");
  if(sha!==m.sha256)throw Error("Backup checksum mismatch");
  const db=new Database(dbFile,{readonly:true});
  try{if(db.pragma("integrity_check",{simple:true})!=="ok")throw Error("Backup integrity check failed")}finally{db.close()}
  return m
}
