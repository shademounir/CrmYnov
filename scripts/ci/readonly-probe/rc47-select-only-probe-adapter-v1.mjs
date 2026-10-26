// Dependency-injected exact-image Prisma client. Never instantiates a client or reads credentials here.
import assert from'node:assert/strict';
import{collectSnapshot,validateEnvelope,validateSnapshot}from'./rc47-select-only-probe-core-v1.mjs';
export async function runReadOnlyProbe(client,envelope,baseline=null){
 validateEnvelope(envelope);assert.equal(typeof client?.$transaction,'function');
 return client.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='3000ms'");
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1000ms'");
  await tx.$executeRawUnsafe("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
  const snapshot=await collectSnapshot((_key,sql,parameters)=>tx.$queryRawUnsafe(sql,...parameters),envelope);
  const report=validateSnapshot(snapshot,envelope,baseline);
  // The caller must persist snapshot in scoped private evidence only; stdout gets report only.
  return {report,snapshot};
 },{isolationLevel:'RepeatableRead',maxWait:5000,timeout:25000});
}
