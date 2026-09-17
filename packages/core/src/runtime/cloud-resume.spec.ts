import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "./index.js";
import { SessionStore, PAGE_SIZE } from "../account/store.js";
import { testWallet } from "../account/keypairWallet.js";
import { mirrorStorage } from "../account/storage/mirror.js";
import type { StorageAdapter } from "./contract.js";
vi.mock("./spawn.js", () => ({ spawnCli: vi.fn((opts: any) => ({
 send: vi.fn(), stop: vi.fn(), interrupt: vi.fn(), onSessionId: (cb: any) => cb(opts.sessionId || "fresh"),
 onMessage: () => {}, onSkill: () => {}, onUsage: () => {}, onCompact: () => {}, onTurnEnd: () => {}, onError: () => {},
})) }));
// Keep all engine-native writes out of the user's installed engines.
vi.mock("./inject/claude.js", () => ({ injectClaude: vi.fn(async () => {}) }));
vi.mock("./inject/codex.js", () => ({ injectCodex: vi.fn(async () => {}) }));
function memory(): StorageAdapter {
 const blobs = new Map<string, Uint8Array>();
 return { get: async id => blobs.get(id)?.slice() ?? null, put: async (id,bytes) => { blobs.set(id,bytes.slice()); },
 list: async () => [...blobs.keys()], remove: async id => { blobs.delete(id); },
 append: async (id,bytes) => { const old=blobs.get(id)??new Uint8Array(); const next=new Uint8Array(old.length+bytes.length); next.set(old);next.set(bytes,old.length);blobs.set(id,next); } };
}
const meta={sessionId:"shared",cli:"claude" as const,title:"Original conversation",ts:1};
let home:string;
const originalHome=process.env.AGENTNET_HOME;
beforeEach(()=>{home=mkdtempSync(join(tmpdir(),"agentnet-cloud-resume-"));process.env.AGENTNET_HOME=home;});
afterEach(()=>{if(originalHome===undefined)delete process.env.AGENTNET_HOME;else process.env.AGENTNET_HOME=originalHome;rmSync(home,{recursive:true,force:true});});
describe("cloud resume writer isolation",()=>{
 it("preserves both writers across a page boundary in a fresh cloud reader",async()=>{
  const wallet=testWallet(113),cloud=memory(); delete cloud.append;
  const source=new SessionStore(wallet,cloud);
  for(let i=0;i<PAGE_SIZE;i++)await source.appendMessage(meta,{role:"user",text:`shared ${i}`,ts:i+1});
  const before = new Map(await Promise.all((await cloud.list()).map(async k=>[k,await cloud.get(k)] as const)));
  const localA=memory(),localB=memory();
  for(const [k,v] of before){await localA.put(k,v!);await localB.put(k,v!);}
  const a=createRuntime(wallet,mirrorStorage(localA,cloud)),b=createRuntime(wallet,mirrorStorage(localB,cloud));
  const [ha,hb]=await Promise.all([a.startSession({cli:"claude",cwd:home,sessionId:"shared"}),b.startSession({cli:"claude",cwd:home,sessionId:"shared"})]);
  expect(ha.sessionId).toBe("shared"); expect(hb.sessionId).toBe("shared");
  ha.send("기기 A의 새 메시지");hb.send("device B new message");
  await vi.waitFor(async()=>{
    expect((await new SessionStore(wallet,localA).load(ha.sessionId))?.messages).toHaveLength(PAGE_SIZE+1);
    expect((await new SessionStore(wallet,localB).load(hb.sessionId))?.messages).toHaveLength(PAGE_SIZE+1);
  });
  await vi.waitFor(async()=>{
   const fresh=new SessionStore(wallet,cloud);
   const messages = (await fresh.load("shared"))!.messages;
   expect(messages).toHaveLength(PAGE_SIZE + 2);
   expect(messages.map(m => m.text)).toContain("기기 A의 새 메시지");
   expect(messages.map(m => m.text)).toContain("device B new message");
  },{timeout:5000,interval:100});
  const listed=await new SessionStore(wallet,cloud).listMine();expect(listed).toHaveLength(1);
  expect(listed[0].sessionId).toBe("shared");
  for(const[k,v]of before)expect(await cloud.get(k)).toEqual(v);
  ha.stop();hb.stop();
 },15000);
 it("keeps local-only resumes on their original id",async()=>{
  const wallet=testWallet(114),local=memory();await new SessionStore(wallet,local).appendMessage(meta,{role:"user",text:"local",ts:1});
  const h=await createRuntime(wallet,mirrorStorage(local)).startSession({cli:"claude",cwd:home,sessionId:"shared"});
  expect(h.sessionId).toBe("shared");h.stop();
 });
 it("refuses to fork missing pages instead of copying partial history",async()=>{
  const wallet=testWallet(115),storage=memory(),store=new SessionStore(wallet,storage);
  for(let i=0;i<=PAGE_SIZE;i++)await store.appendMessage(meta,{role:"user",text:`message ${i}`,ts:i});
  await storage.remove("shared__p0");
  await expect(store.fork("shared","branch","Branch")).rejects.toThrow("incomplete fork");
  expect((await storage.list()).some(k=>k.startsWith("branch__p"))).toBe(false);
 });
 it("ephemeral cloud resumes do not create or modify persisted pages",async()=>{
  const wallet=testWallet(116),cloud=memory();delete cloud.append;
  await new SessionStore(wallet,cloud).appendMessage(meta,{role:"user",text:"shared",ts:1});
  const keys=await cloud.list();const before=await cloud.get(keys[0]);
  const local=memory();
  const h=await createRuntime(wallet,mirrorStorage(local,cloud)).startSession({cli:"claude",cwd:home,sessionId:"shared",ephemeral:true});
  expect(h.sessionId).toBe("shared");expect(await local.list()).toEqual([]);
  expect(await cloud.list()).toEqual(keys);expect(await cloud.get(keys[0])).toEqual(before);h.stop();
 });
 it("offline resumes preserve the session id and backfill their own chain",async()=>{
  const wallet=testWallet(117),local=memory();await new SessionStore(wallet,local).appendMessage(meta,{role:"user",text:"offline base",ts:1});
  const cloud=memory();delete cloud.append;let online=false;
  const put=cloud.put;cloud.put=async(k,v)=>{if(!online)throw Error("invalid_grant");await put(k,v);};
  const mirror=mirrorStorage(local,cloud);const h=await createRuntime(wallet,mirror).startSession({cli:"claude",cwd:home,sessionId:"shared"});
  h.send("offline branch message");
  await vi.waitFor(async()=>expect((await new SessionStore(wallet,local).load(h.sessionId))?.messages).toHaveLength(2));
  expect(h.sessionId).toBe("shared");
  // Let the failed deferred upload settle before reconnecting.
  await new Promise(resolve=>setTimeout(resolve,2700));
  online=true;await mirror.backfill!();
  expect((await new SessionStore(wallet,cloud).load(h.sessionId))?.messages.at(-1)?.text).toBe("offline branch message");h.stop();
 });

});
