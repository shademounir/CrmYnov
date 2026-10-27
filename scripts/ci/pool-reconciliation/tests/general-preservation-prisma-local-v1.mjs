// LOCAL synthetic PostgreSQL only. Not a Cloud Run entry or native verifier.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runGeneralPreservationReadOnlyCollection,QUERY_CONTRACT_SHA256,PURPOSE} from '../general-preservation-read-only-collector-v1.mjs';
import {runSchemaLedgerReadOnlyCollection,QUERY_CONTRACT_SHA256 as LEDGER_HASH,PURPOSE as LEDGER_PURPOSE,QUERIES as LEDGER_QUERIES} from '../schema-ledger-read-only-collector-v1.mjs';
assert.equal(process.env.CRM_QUALIFICATION_SCOPE,'LOCAL_SYNTHETIC_ONLY');
assert.equal(process.versions.node,'22.23.3');assert.equal(process.getuid(),65532);assert.equal(process.getgid(),65532);
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/crmynov_prod');assert.equal(url.password,'synthetic-local-only');
const mode=process.env.LOCAL_MODE;assert(['GENERAL','WRITE_REFUSAL','WRONG_ROLE','LEDGER_DENIED','LEDGER'].includes(mode));
const {PrismaClient}=createRequire('/workspace/package.json')('@prisma/client');
const client=new PrismaClient({log:[],errorFormat:'minimal'}),request={schemaVersion:1,purpose:PURPOSE,phase:'PRE',campusId:'00000000-0000-4000-8000-000000000001',queryContractSha256:QUERY_CONTRACT_SHA256};
try{
  let report;
  if(mode==='GENERAL'){
    assert.equal(url.username,'crm_runtime');
    const pre=await runGeneralPreservationReadOnlyCollection(client,request),post=await runGeneralPreservationReadOnlyCollection(client,{...request,phase:'POST'});
    assert.equal(pre.identity.role,'crm_runtime');assert.equal(pre.identity.readOnly,'on');assert.equal(pre.identity.isolation,'repeatable read');assert.deepEqual(pre.snapshot,post.snapshot);assert.equal(pre.snapshotSha256,post.snapshotSha256);
    assert.equal(pre.snapshot.memberships.length,32);assert.equal(pre.snapshot.roster.length,8);assert.equal(pre.snapshot.scopes.length,5);assert.equal(pre.snapshot.leads.length,2);assert.equal(pre.snapshot.pool.length,1);assert.equal(pre.snapshot.journal.length,1);assert(pre.snapshot.journal.every(x=>typeof x.sending_at==='string'));
    for(const o of [pre,post]){assert.equal(o.separateLedgerRequired,true);for(const k of ['nativeEvidenceAuthenticated','migrationLedgerObserved','sameSnapshotAsLedger','sameSnapshotAsPool','historicalRawPoolHashRecovered','fullPreservationValidated','activationAuthorized'])assert.equal(o[k],false);}
    report={role:pre.identity.role,readOnly:pre.identity.readOnly,isolation:pre.identity.isolation,counts:Object.fromEntries(Object.entries(pre.snapshot).map(([k,v])=>[k,v.length])),snapshotSha256:pre.snapshotSha256,postEqual:true,separateLedgerRequired:true,sameSnapshotAsLedger:false};
  }else if(mode==='WRITE_REFUSAL'){
    let code,attempts=0;
    const guarded={$transaction:(callback,options)=>client.$transaction(tx=>callback({$executeRawUnsafe:s=>tx.$executeRawUnsafe(s),$queryRawUnsafe:async()=>{attempts++;return tx.$executeRawUnsafe("INSERT INTO public.system_probes(id) VALUES ('11111111-1111-4111-8111-111111111111')");}}),options)};
    try{await runGeneralPreservationReadOnlyCollection(guarded,request);}catch(e){code=e.meta?.code;}
    assert.equal(code,'25006');assert.equal(attempts,1);report={writeRefusalCode:code,collectorSettingsApplied:true,partialObservationReturned:false};
  }else if(mode==='WRONG_ROLE'){
    assert.equal(url.username,'crm_migrator');await assert.rejects(runGeneralPreservationReadOnlyCollection(client,request),/RUNTIME_ROLE_ONLY/u);report={wrongRoleRefused:true};
  }else if(mode==='LEDGER_DENIED'){
    assert.equal(url.username,'crm_runtime');let code;try{await client.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await tx.$queryRawUnsafe(LEDGER_QUERIES.migrations);});}catch(e){code=e.meta?.code;}
    assert.equal(code,'42501');report={runtimeLedgerDeniedCode:code};
  }else{
    assert.equal(url.username,'crm_migrator');const o=await runSchemaLedgerReadOnlyCollection(client,{schemaVersion:1,purpose:LEDGER_PURPOSE,phase:'PRE',queryContractSha256:LEDGER_HASH});
    assert.equal(o.snapshot.migrations.length,56);assert.equal(o.schemaCompatibilityProved,false);assert.equal(o.sameSnapshotAsPool,false);assert.equal(o.nativeEvidenceAuthenticated,false);
    report={role:o.identity.role,readOnly:o.identity.readOnly,isolation:o.identity.isolation,ledger:o.snapshot.migrations,counts:Object.fromEntries(Object.entries(o.snapshot).map(([k,v])=>[k,v.length])),schemaSurfaceSha256:o.schemaSurfaceSha256,sameSnapshotAsGeneral:false};
  }
  console.log(JSON.stringify({schemaVersion:1,scope:'ACTUAL_RC48_PRISMA_SYNTHETIC_LOCAL_POSTGRESQL17_ONLY',mode,...report,nativeAcceptance:false,prodSqlExecuted:false,activation:false}));
}finally{await client.$disconnect();}
