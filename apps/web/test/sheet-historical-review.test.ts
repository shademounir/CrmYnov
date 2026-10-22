import assert from "node:assert/strict";import test,{type TestContext} from "node:test";import {JSDOM}from"jsdom";
import{historicalReviewState,historicalCommand,historicalPendingDisposition}from"../app/admin/scheduled-sheets/historical-review-client";
import type{ApiObject}from"../app/_components/connected-resource";
const state=():ApiObject=>({policy:"REVIEWED_HISTORICAL_SOURCE_AMENDMENT_V1",activationAllowed:false,businessEffects:0,boundaryRow:2586,generation:"615e16cf-5029-4b48-90e8-76900990d63f",connectorVersion:1,revision:0,capabilitySha256:"a".repeat(64),transitions:[{row:2585,column:8,originalFingerprint:"b".repeat(64),acceptedFingerprint:"c".repeat(64)},{row:2586,column:8,originalFingerprint:"d".repeat(64),acceptedFingerprint:"e".repeat(64)}],decisions:[]});

async function recoveryUi(t:TestContext,request:(url:string,init?:RequestInit)=>Promise<Response>):Promise<{doc:Document;read():Promise<void>;reason(row:number,value:string):Promise<void>;confirm(row:number):Promise<void>}>{
 const dom=new JSDOM("<!doctype html><div id='root'></div>",{url:"http://localhost/admin/scheduled-sheets"}),saved=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value]of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
 const {act,createElement}=await import("react"),{createRoot}=await import("react-dom/client"),{SheetHistoricalReview}=await import("../app/admin/scheduled-sheets/sheet-historical-review");const root=createRoot(dom.window.document.getElementById("root")!);
 t.after(async()=>{await act<void>(()=>root.unmount());dom.window.close();for(const [k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}});t.mock.method(globalThis,"fetch",request);
 const button=(label:string):HTMLButtonElement=>{const b=Array.from(dom.window.document.querySelectorAll("button")).find(x=>x.textContent===label);assert(b,label);return b;};
 await act<void>(()=>root.render(createElement(SheetHistoricalReview,{connectorId:"synthetic-connector",disabled:false})));
 return {doc:dom.window.document,read:async():Promise<void>=>{await act(async():Promise<void>=>{button("Relire la source et les reçus historiques").click();await Promise.resolve();});},reason:async(row,value):Promise<void>=>{const f=dom.window.document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Motif individuel H${row}"]`)??Array.from(dom.window.document.querySelectorAll("textarea")).find(x=>x.parentElement?.textContent===`Motif individuel H${row}`);assert(f);await act<void>(()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,"value")!.set!.call(f,value);f.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});},confirm:async(row):Promise<void>=>{await act(async():Promise<void>=>{button(`Acquitter uniquement H${row}`).click();await Promise.resolve();});}};
}

test("pending reconciliation keeps uncertain keys but releases refused or obsolete CAS commands",()=>{
 const s=historicalReviewState(state()),p=historicalCommand(s,2586,"Reviewed synthetic source only","historical-00000000-0000-4000-8000-000000000001");
 assert.equal(historicalPendingDisposition(s,p,false),"unknown");assert.equal(historicalPendingDisposition(s,p,true),"obsolete");assert.equal(historicalPendingDisposition({...s,revision:1},p,false),"obsolete");assert.equal(historicalPendingDisposition({...s,connectorVersion:2},p,false),"obsolete");
 assert.equal(historicalPendingDisposition({...s,decisions:[{row:2586,revision:1,idempotencyKey:p.idempotencyKey,receiptHash:"f".repeat(64),reason:p.reason}]},p,true),"recorded");
});

test("concurrent administrator conflict is reconciled before a fresh explicit command",async t=>{
 const bodies:Array<Record<string,unknown>>=[];const other={row:2585,revision:1,idempotencyKey:"historical-00000000-0000-4000-8000-000000000002",receiptHash:"f".repeat(64),reason:"Other administrator decision"};
 const ui=await recoveryUi(t,(_url,init):Promise<Response>=>{if(init?.method==="POST"){assert(typeof init.body==="string");bodies.push(JSON.parse(init.body) as Record<string,unknown>);return Promise.resolve(Response.json({code:"revision_conflict"},{status:409}));}return Promise.resolve(Response.json(bodies.length?{...state(),revision:1,decisions:[other]}:state()));});
 await ui.read();await ui.reason(2586,"Reviewed synthetic source H2586 only");await ui.confirm(2586);assert.equal(ui.doc.querySelectorAll("textarea").length,0);await ui.read();
 assert.match(ui.doc.body.textContent??"",/Demande refusée ou obsolète/);assert.equal(bodies.length,1);assert.equal(ui.doc.querySelectorAll("textarea").length,1);
 await ui.confirm(2586);assert.equal(bodies.length,2);assert.equal(bodies[1]?.expectedRevision,1);assert.notEqual(bodies[0]?.idempotencyKey,bodies[1]?.idempotencyKey);
});

test("lost response with unchanged inventory retains and retries the identical command",async t=>{
 const bodies:string[]=[];const ui=await recoveryUi(t,(_url,init):Promise<Response>=>{if(init?.method==="POST"){assert(typeof init.body==="string");bodies.push(init.body);return Promise.reject(Error("unknown outcome"));}return Promise.resolve(Response.json(state()));});
 await ui.read();await ui.reason(2586,"Reviewed synthetic source H2586 only");await ui.confirm(2586);await ui.read();assert.equal(bodies.length,1);
 const retry=Array.from(ui.doc.querySelectorAll("button")).find(x=>x.textContent==="Réessayer la même demande conservée");assert(retry);
 const {act}=await import("react");await act(async():Promise<void>=>{retry.click();await Promise.resolve();});assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
});
test("historical client rejects incomplete, forged success and changed pilot bounds",()=>{
 const valid=state();assert.equal(historicalReviewState(valid).revision,0);
 for(const patch of [{activationAllowed:true},{businessEffects:1},{boundaryRow:2587},{revision:2},{connectorVersion:0},{transitions:[]}])assert.throws(()=>historicalReviewState({...valid,...patch}));
});

test("historical review exposes individually named reason help and semantic full fingerprints without a write",async t=>{
 const calls:string[]=[];const ui=await recoveryUi(t,(url,init):Promise<Response>=>{calls.push(`${init?.method??"GET"} ${url}`);return Promise.resolve(Response.json(state()));});
 assert.equal(calls.length,0);await ui.read();
 assert.ok(ui.doc.querySelector(".sheets-historical-review"));assert.equal(ui.doc.querySelectorAll(".sheets-historical-fingerprints dt").length,4);
 assert.deepEqual(Array.from(ui.doc.querySelectorAll(".sheets-historical-fingerprints code")).map(x=>x.textContent),["b".repeat(64),"c".repeat(64),"d".repeat(64),"e".repeat(64)]);
 for(const row of [2585,2586]){const field=ui.doc.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Motif individuel H${row}"]`);assert.ok(field);assert.equal(field.rows,4);assert.equal(field.maxLength,1000);const help=ui.doc.getElementById(field.getAttribute("aria-describedby")??"");assert.match(help?.textContent??"",/sans donnée personnelle/);assert.match(help?.textContent??"",/une seule ligne/);}
 assert.equal(calls.length,1);assert.ok(calls.every(c=>c.startsWith("GET ")));assert.equal(ui.doc.querySelector("[role=status]"),null);
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
 await act(async():Promise<void>=>{button("Acquitter uniquement H2585").click();button("Acquitter uniquement H2585").click();await Promise.resolve();});
 assert.equal(posts,1);assert.equal(host.querySelectorAll("textarea").length,0);assert.match(host.textContent??"",/Relisez avant toute reprise/);assert.doesNotMatch(host.textContent??"",/Reçu H2585 relu/);
 await act(async():Promise<void>=>{button("Relire la source et les reçus historiques").click();await Promise.resolve();});
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
