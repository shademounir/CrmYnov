import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../controlled-pool-contract-v1.mjs';
import {GENERAL_INCIDENT,makeGeneralHistoricalSearchPlan,makeFreshPreContractProposal} from '../general-historical-search-plan-v1.mjs';
test('historical plan names exact incident, job UID, UTC intent and CREATE exclusion without execution',t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('NO_NATIVE_CALL');});
  const plan=makeGeneralHistoricalSearchPlan({...GENERAL_INCIDENT});
  const {planSha256,...body}=plan;assert.equal(planSha256,digest(body));
  assert.equal(plan.audit.methodName,'google.cloud.run.v2.Jobs.RunJob');assert.equal(plan.audit.permissionType,'DATA_WRITE');
  assert(plan.audit.filter.includes(GENERAL_INCIDENT.job));assert.equal(plan.nativeExecutionAuthorized,false);
  assert.equal(plan.expectedEffects.jobRun,false);assert.equal(plan.expectedEffects.originalJournalWrite,false);
  assert(plan.methods.every(method=>method.semantic==='READ_ONLY'&&!method.automaticRetry));
  assert(plan.methods.some(method=>method.http==='POST'&&method.apiMethod.endsWith('.ListLogEntries')));
  assert(!plan.methods.some(method=>/\.(RunJob|CreateJob|UpdateJob|DeleteJob|CancelExecution|SetIamPolicy)$/u.test(method.apiMethod)));
});
test('historical plan requires complete-or-bounded pagination and deleted unexpired execution coverage',()=>{
  const plan=makeGeneralHistoricalSearchPlan(GENERAL_INCIDENT);
  const list=plan.methods.find(method=>method.apiMethod.endsWith('.ListExecutions'));
  assert(list.conditions.includes('showDeleted=true'));assert(list.fields.includes('nextPageToken'));
  assert.equal(plan.bounds.maximumDurationSeconds,900);assert.equal(plan.bounds.maximumRequests,200);
  assert(plan.audit.currentConfigurationDoesNotProveHistoricalConfiguration);
  const entries=plan.methods.find(method=>method.apiMethod.endsWith('.ListLogEntries'));
  assert(entries.conditions.some(value=>value.includes('entries=[]')&&value.includes('nextPageToken')));
  assert(entries.temporaryIdentityComparisonFields.includes('protoPayload.authenticationInfo.principalSubject'));
  assert(!entries.fields.some(value=>value.includes('authenticationInfo')));
  assert(plan.permissionsToTest.includes('logging.views.access'));
  assert(plan.knownCoverageLimits.some(value=>value.includes('historical ancestor configuration remains UNPROVEN')));
  assert(plan.expectedEffects.readAuditEventsMayBeGenerated);assert.equal(plan.canRetry,false);
});
for(const field of Object.keys(GENERAL_INCIDENT))test('refuses substitute incident '+field,()=>{assert.throws(()=>makeGeneralHistoricalSearchPlan({...GENERAL_INCIDENT,[field]:'substitute'}));assert.throws(()=>makeFreshPreContractProposal({...GENERAL_INCIDENT,[field]:'substitute'}));});
test('fresh PRE proposal explicitly preserves unknown and freshness, creates no execution capability',()=>{
  const proposal=makeFreshPreContractProposal(GENERAL_INCIDENT);
  assert.equal(proposal.status,'PROPOSAL_ONLY_NOT_AUTHORIZED');assert.equal(proposal.newRunAuthorized,false);
  assert.equal(proposal.newObjectiveCreated,false);assert.equal(proposal.newJobNameGenerated,false);
  assert.equal(proposal.nativeCalls,0);assert(proposal.preserved.includes('300000ms freshness limit'));
  assert.equal(proposal.executionPlanGenerated,false);assert.equal(proposal.activationAuthorized,false);
});
