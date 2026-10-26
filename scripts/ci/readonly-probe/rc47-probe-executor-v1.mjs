// No CLI, job creation, permission changes or implicit authorization.
// A protected, reviewed driver must supply fresh official authority and authentication.
import assert from 'node:assert/strict';
import {dispatchOnce,observeKnownOperation} from './rc47-probe-single-run-v1.mjs';
import {openExclusiveJournal} from './rc47-probe-exclusive-journal-v1.mjs';
import {createHttpContract} from './rc47-probe-http-contract-v1.mjs';
import {createBoundedExchange} from './rc47-probe-bounded-exchange-v1.mjs';
import {validateProbeObjective,validateNativeJob,validateNativeExecution} from './rc47-probe-native-guards-v1.mjs';

export function createProbeExecutor({objective,authorizeFresh,accessToken,journalDirectory,initialize=false,fetchImpl}) {
  assert.equal(typeof authorizeFresh,'function','fresh protected authority verifier required');
  assert.equal(typeof accessToken,'function','explicit official authentication required');
  // Detach caller-owned inputs: neither a concurrent edit nor a callback can retarget a run.
  const target=structuredClone(objective);
  validateProbeObjective(target);
  const transport=createHttpContract({exchange:createBoundedExchange({accessToken,...(fetchImpl?{fetchImpl}:{})})});
  const journal=openExclusiveJournal({directory:journalDirectory,jobName:target.jobName,objectiveSha256:target.objectiveSha256,initialize});
  const authority=async()=>{await authorizeFresh(structuredClone(target));};
  let busy=false,closed=false;
  async function exclusive(action) {
    assert.equal(closed,false,'executor closed');assert.equal(busy,false,'executor busy');busy=true;
    try{return await action();}finally{busy=false;}
  }
  return Object.freeze({
    dispatch:()=>exclusive(()=>dispatchOnce({objective:target,authorizeFresh:authority,transport,journal,validateNativeJob})),
    // A supplied operation name is never accepted. Recovery reads the consumed durable journal.
    observe:()=>exclusive(async()=>{
      const saved=journal.acceptedReceipt();
      return observeKnownOperation({receipt:saved,objective:target,transport,journal,validateNativeExecution});
    }),
    inspect:()=>{assert.equal(closed,false);return journal.inspect();},
    close:()=>{assert.equal(busy,false,'executor busy');journal.close();closed=true;}
  });
}
