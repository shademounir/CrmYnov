import assert from "node:assert/strict";import test from "node:test";import * as fs from "node:fs/promises";import{tmpdir}from"node:os";import{join,resolve}from"node:path";
import {readPinnedPrivateArtifact,artifactSha256,type ArtifactIO} from "../src/sheet-import/sheet-private-artifact.js";
import{historicalFixture}from"./fixtures/import/historical-amendment.synthetic.js";
import{readHistoricalCapability,validateHistoricalSource,readHistoricalRequest,readHistoricalPin,historicalHash}from"../src/sheet-import/sheet-historical-contract.js";
import{appendBootstrapProofHash,appendBootstrapQualified,readAppendQualification}from"../src/sheet-import/sheet-append-qualification.js";
import{appendObservationConflict,type AppendStream}from"../src/sheet-import/sheet-append-ledger.js";
import{appendPositions}from"../src/sheet-import/sheet-append-contract.js";
const repo=resolve(__dirname,"../../.."),redacted=(e:unknown):boolean=>e instanceof Error&&e.message==="historical_private_artifact_unavailable";
test("canonical historical hashes preserve UTF-16 wire order, not locale collation",()=>{
 assert.equal(historicalHash({z:1,a:2,A:3,"é":4,"😀":5}),artifactSha256(Buffer.from('{"A":3,"a":2,"z":1,"é":4,"😀":5}')));
 assert.equal(historicalHash({a:[{z:1,A:2}]}),historicalHash({a:[{A:2,z:1}]}));
});
test("historical private artifacts: native filesystem, bounded UTF8 and fail-closed cleanup",async t=>{
 const dir=await fs.mkdtemp(join(process.env.CRMY63_HISTORICAL_ARTIFACT_ROOT??tmpdir(),"crmy63-historical-files-")),file=join(dir,"private.json"),bytes=Buffer.from('{"ok":true}');await fs.writeFile(file,bytes);
 const binding={path:file,sha256:artifactSha256(bytes),maxBytes:bytes.length};assert.deepEqual((await readPinnedPrivateArtifact(binding,repo)).raw,{ok:true});
 await t.test("close failure is redacted and cannot return a successful artifact",async()=>{
  const io:ArtifactIO={...fs,open:async(...args)=>{const handle=await fs.open(...args);return new Proxy(handle,{get(target,key):unknown{if(key==="close")return async():Promise<never>=>{await target.close();throw Error("private-path-close-secret");};const v:unknown=Reflect.get(target,key);return typeof v==="function"?v.bind(target) as unknown:v;}});}};
  await assert.rejects(readPinnedPrivateArtifact(binding,repo,io),redacted);
 });
 await t.test("ancestor access denial is not mistaken for missing Git metadata",async()=>{const io:ArtifactIO={...fs,access:()=>Promise.reject(Object.assign(Error("private-path"),{code:"EACCES"}))};await assert.rejects(readPinnedPrivateArtifact(binding,repo,io),redacted);});
 await t.test("post-read inode/path replacement is refused without unsafe integer rounding",async()=>{let calls=0;const io:ArtifactIO={...fs,lstat:(async(...args:Parameters<typeof fs.lstat>)=>{const s=await fs.lstat(...args);assert.equal(typeof s.ino,"bigint");calls++;if(calls>1)return new Proxy(s,{get(target,key):unknown{const value:unknown=Reflect.get(target,key);return key==="ino"?BigInt(target.ino)+1n:value;}});return s;}) as typeof fs.lstat};await assert.rejects(readPinnedPrivateArtifact(binding,repo,io),redacted);});
 for(const [name,patch]of [["relative",{path:"private.json"}],["digest",{sha256:"0".repeat(64)}],["oversize",{maxBytes:bytes.length-1}],["UNC",{path:"\\\\invalid-host\\file"}]] as const)await t.test(name,async()=>{await assert.rejects(readPinnedPrivateArtifact({...binding,...patch},repo),redacted);});
 for(const [name,value]of [["UTF8 BOM",Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d])],["invalid UTF8",Buffer.from([0x22,0xc3,0x28,0x22])],["invalid JSON",Buffer.from("{invalid")]] as const)await t.test(name,async()=>{const p=join(dir,name.replaceAll(" ","-")+".json");await fs.writeFile(p,value);await assert.rejects(readPinnedPrivateArtifact({path:p,sha256:artifactSha256(value),maxBytes:65536},repo),redacted);});
 await t.test("hardlink refused",async()=>{await fs.link(file,join(dir,"hardlink.json"));await assert.rejects(readPinnedPrivateArtifact(binding,repo),redacted);});
});
test("historical capability binds exact H-only changes without moving N0 or original fingerprints",()=>{
 const f=historicalFixture(),before=JSON.stringify(f.contract),tail=JSON.stringify(f.values.slice(2586));validateHistoricalSource(f.files,f.contract,f.capability.campusId,f.values);assert.equal(JSON.stringify(f.contract),before);assert.equal(JSON.stringify(f.values.slice(2586)),tail);
 const changed=structuredClone(f.values);changed[2583]=["third-change"];assert.throws(()=>validateHistoricalSource(f.files,f.contract,f.capability.campusId,changed));
 for(const patch of [{boundaryRow:2587},{range:"B1:CV10001"},{campusId:"bad"},{unexpected:true}])assert.throws(()=>readHistoricalCapability({...f.capability,...patch},f.boundary,f.contract.artifactSha256));
 const t=structuredClone(f.capability);t.transitions[0]!.acceptedCells[4]="other identity";assert.throws(()=>readHistoricalCapability(t,f.boundary,f.contract.artifactSha256));
});
test("historical requests accept no paths, values, N0, other rows or inferred decisions",()=>{
 const valid={row:2585,reason:"Reviewed synthetic source only",confirmed:true,expectedVersion:1,expectedRevision:0,idempotencyKey:"historical-00000000-0000-4000-8000-000000000001"};assert.equal(readHistoricalRequest(valid).row,2585);
 for(const patch of [{row:2584},{row:"2585"},{confirmed:false},{reason:"short"},{reason:" line\nvalue"},{expectedRevision:2},{expectedVersion:0},{path:"secret.json"},{cells:[]},{boundaryRow:2587}])assert.throws(()=>readHistoricalRequest({...valid,...patch}));
});
test("schema3 separates both receipt pins and preserves bootstrapV2 hash semantics",()=>{
 const report={cutoverBlocked:true,reconciliation:{axes:{immutableEffects:"unchanged",currentDossierOwner:"old"}},boundedReconciliation:{policy:"EXPLICIT_DEFERRED_V1",qualified:true,executedComplete:true,unresolvedOccurrences:0,inventorySha256:"e".repeat(64),deferredOccurrences:5,deferredWithoutUsableContact:1,reservationsAreConservativeNotIdentityProof:true}};
 const q={schemaVersion:3,bootstrapProofVersion:2,mode:"LOCAL_ROW_APPEND_ONLY",policy:"LOCAL_ROW_APPEND_ONLY_V1",boundaryArtifactSha256:"a".repeat(64),bootstrapPackageId:"11111111-1111-4111-8111-111111111111",excelSha256:"d".repeat(64),reportSha256:appendBootstrapProofHash(report,2),bindingSha256:"b".repeat(64),evidenceSha256:"f".repeat(64),qualifiedAt:"2026-01-01T00:00:01.000Z",producerCondition:{confirmedAt:"2026-01-01T00:00:00.000Z",evidenceSha256:"a".repeat(64)},boundedBootstrap:{policy:"EXPLICIT_DEFERRED_V1",inventorySha256:"e".repeat(64),deferredOccurrences:5,deferredWithoutUsableContact:1,reservationPolicy:"CONTACT_OR_EXACT_NAME_REVIEW_NO_AUTO_LINK"},historicalAmendments:{policy:"REVIEWED_HISTORICAL_SOURCE_AMENDMENT_V1",inventorySha256:"1".repeat(64),receiptInventorySha256:"2".repeat(64),capabilityArtifactSha256:"c".repeat(64),count:2,revision:2}};
 const parsed=readAppendQualification(q);assert(appendBootstrapQualified(report,parsed));assert(appendBootstrapQualified({...report,reconciliation:{axes:{immutableEffects:"unchanged",currentDossierOwner:"new"}}},parsed));assert(!appendBootstrapQualified({...report,boundedReconciliation:{...report.boundedReconciliation,unresolvedOccurrences:1}},parsed));
 for(const patch of [{bootstrapProofVersion:1},{schemaVersion:2},{historicalAmendments:{...q.historicalAmendments,revision:1}},{unreviewed:true}])assert.throws(()=>readAppendQualification({...q,...patch}));
 assert.throws(()=>readHistoricalPin({...q.historicalAmendments,receiptInventorySha256:undefined}));
});
test("worker source comparison stays strict unless a verified receipt projection is explicitly supplied",()=>{
 const f=historicalFixture(),stream:AppendStream&{contract:typeof f.contract}={id:"synthetic",campusId:f.capability.campusId,suspended:false,errorCode:null,contract:f.contract,qualification:null,lastObservedRow:2586,lastDurableRow:2586};
 const observed=appendPositions(f.contract.range,f.values),accepted=f.capability.transitions.map(t=>({row:t.row,fingerprint:t.acceptedFingerprint}));
 assert.equal(appendObservationConflict(stream,observed,[]),"append_historical_row_changed");assert.equal(appendObservationConflict(stream,observed,[],accepted),null);
 f.values[2583]=["third-change"];assert.equal(appendObservationConflict(stream,appendPositions(f.contract.range,f.values),[],accepted),"append_historical_row_changed");
});
