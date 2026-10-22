import assert from "node:assert/strict";import test from "node:test";import {JSDOM}from"jsdom";
import{historicalReviewState,historicalCommand}from"../app/admin/scheduled-sheets/historical-review-client";
import type{ApiObject}from"../app/_components/connected-resource";
const state=():ApiObject=>({policy:"REVIEWED_HISTORICAL_SOURCE_AMENDMENT_V1",activationAllowed:false,businessEffects:0,boundaryRow:2586,generation:"615e16cf-5029-4b48-90e8-76900990d63f",connectorVersion:1,revision:0,capabilitySha256:"a".repeat(64),transitions:[{row:2585,column:8,originalFingerprint:"b".repeat(64),acceptedFingerprint:"c".repeat(64)},{row:2586,column:8,originalFingerprint:"d".repeat(64),acceptedFingerprint:"e".repeat(64)}],decisions:[]});
test("historical client rejects incomplete, forged success and changed pilot bounds",()=>{
 const valid=state();assert.equal(historicalReviewState(valid).revision,0);
 for(const patch of [{activationAllowed:true},{businessEffects:1},{boundaryRow:2587},{revision:2},{connectorVersion:0},{transitions:[]}])assert.throws(()=>historicalReviewState({...valid,...patch}));
});

test("historical UI reconciles a lost acknowledgement response without replaying or inventing success",async t=>{
 const dom=new JSDOM("<!doctype html><div id='root'></div>",{url:"http://localhost/admin/scheduled-sheets"}),saved=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value]of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
 const {act,createElement}=await import("react"),{createRoot}=await import("react-dom/client"),{SheetHistoricalReview}=await import("../app/admin/scheduled-sheets/sheet-historical-review");
 const host=dom.window.document.getElementById("root")!,root=createRoot(host);let body:Record<string,unknown>|undefined,posts=0,reads=0;
 t.after(async()=>{await act<void>(()=>root.unmount());dom.window.close();for(const [k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}});
 t.mock.method(globalThis,"fetch",(_url:string,init?:RequestInit):Promise<Response>=>{if(init?.method==="POST"){posts++;assert.equal(typeof init.body,"string");assert(typeof init.body==="string");body=JSON.parse(init.body) as Record<string,unknown>;throw Error("lost synthetic response after durable write");}reads++;const next=state();return Promise.resolve(Response.json(body?{...next,revision:1,decisions:[{row:2585,revision:1,idempotencyKey:body.idempotencyKey,receiptHash:"f".repeat(64),reason:body.reason}]}:next));});
 await act<void>(()=>root.render(createElement(SheetHistoricalReview,{connectorId:"synthetic-connector",disabled:false})));
 const button=(label:string):HTMLButtonElement=>{const b=Array.from(host.querySelectorAll("button")).find(x=>x.textContent===label);assert(b,label);return b;};
 await act<void>(()=>button("Relire la source et les reçus historiques").click());
 const field=host.querySelector("textarea")!;
 await act<void>(()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,"value")!.set!.call(field,"Reviewed source H2585 only");field.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});
 assert.equal(button("Acquitter uniquement H2585").disabled,false);
 await act<void>(()=>{button("Acquitter uniquement H2585").click();button("Acquitter uniquement H2585").click();});
 assert.equal(posts,1);assert.equal(host.querySelectorAll("textarea").length,0);assert.match(host.textContent??"",/Relisez avant toute reprise/);assert.doesNotMatch(host.textContent??"",/Reçu H2585 relu/);
 await act<void>(()=>button("Relire la source et les reçus historiques").click());
 assert.equal(posts,1);assert.equal(reads,2);assert.match(host.textContent??"",/Reçu durable retrouvé/);assert.match(host.textContent??"",/1 \/ 2 décisions persistées/);assert.equal(host.querySelectorAll("textarea").length,1);
});
test("historical command contains only individual source acknowledgement fields",()=>{
 const s=historicalReviewState(state()),key="historical-00000000-0000-4000-8000-000000000001";
 const c=historicalCommand(s,2585,"Reviewed source H2585 only",key);
 assert.deepEqual(Object.keys(c).sort(),["row","reason","confirmed","expectedVersion","expectedRevision","idempotencyKey"].sort());assert.equal(c.expectedRevision,0);
 for(const reason of ["short"," trailing ","line\nvalue"])assert.throws(()=>historicalCommand(s,2585,reason,key));
 assert.throws(()=>historicalCommand({...s,revision:2},2585,"Reviewed source H2585 only",key));
});
test("historical component does not load/mutate automatically and refuses unqualified read",async t=>{
 const dom=new JSDOM("<!doctype html><div id='root'></div>",{url:"http://localhost/admin/scheduled-sheets"}),saved=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value]of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
 const {act,createElement}=await import("react"),{createRoot}=await import("react-dom/client"),{SheetHistoricalReview}=await import("../app/admin/scheduled-sheets/sheet-historical-review");
 const host=dom.window.document.getElementById("root")!;const root=createRoot(host),calls:string[]=[];let wrong=true;
 t.after(async()=>{await act<void>(()=>root.unmount());dom.window.close();for(const [k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}});
 t.mock.method(globalThis,"fetch",(url:string,init?:RequestInit):Promise<Response>=>{calls.push(`${init?.method??"GET"} ${url}`);assert.equal(init?.method??"GET","GET");return Promise.resolve(Response.json(wrong?{...state(),activationAllowed:true}:state()));});
 await act<void>(()=>root.render(createElement(SheetHistoricalReview,{connectorId:"synthetic-connector",disabled:false})));assert.equal(calls.length,0);
 const button=():HTMLButtonElement=>Array.from(dom.window.document.querySelectorAll("button")).find(b=>b.textContent==="Relire la source et les reçus historiques")!;
 await act<void>(()=>button().click());assert.match(host.textContent??"",/Preuve historique incomplète/);assert.equal(host.querySelectorAll("textarea").length,0);
 wrong=false;await act<void>(()=>button().click());assert.equal(host.querySelectorAll("textarea").length,2);assert.match(host.textContent??"",/0 \/ 2 décisions persistées/);assert.equal(calls.length,2);assert.match(host.textContent??"",/0 \/ 2 décisions persistées/);assert(calls.every(c=>c.startsWith("GET ")));
});
