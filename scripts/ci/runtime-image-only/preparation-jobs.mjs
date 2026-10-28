// Admit only the two explicitly pinned, completed PRE collectors. The original
// thirteen job identities stay mandatory; no create/run/update capability here.
import assert from 'node:assert/strict';
import {READONLY_RUNTIME_FILES,validateLocalReadOnlyDossier} from '../pool-reconciliation/pool-job-dossier-v1.mjs';
import {validateReadOnlyNativeJob} from '../pool-reconciliation/pool-native-output-v1.mjs';
const purposes=new Set(['GENERAL_PRESERVATION_READ_ONLY_V1','SCHEMA_LEDGER_READ_ONLY_V1']),H=/^[a-f0-9]{64}$/u,U=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,alphabetical=(a,b)=>a.localeCompare(b,'en');
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);assert.deepEqual(Object.keys(value).sort(alphabetical),[...keys].sort(alphabetical));}
export function validateImagePreparationJobs(candidate){
  const rows=candidate.readOnlyPreparationJobs;if(rows===undefined){return [];}
  assert(Array.isArray(rows)&&rows.length===2,'EXPLICIT_GENERAL_AND_LEDGER_PAIR_REQUIRED');
  const names=new Set(),ids=new Set();
  for(const row of rows){
    exact(row,['objectiveId','catalogEntrySha256','dossier','uid','execution']);assert.equal(typeof row.objectiveId,'string');assert.match(row.objectiveId,/^rc48-[a-z0-9-]{8,75}$/u);assert(!ids.has(row.objectiveId));ids.add(row.objectiveId);assert(H.test(row.catalogEntrySha256));assert(U.test(row.uid));
    const d=row.dossier;assert(purposes.has(d?.objective?.purpose),'ONLY_GENERAL_AND_LEDGER_PRE');assert.equal(d.bundle?.request?.phase,'PRE');assert(!names.has(d.objective.jobName));names.add(d.objective.jobName);
    // Rebuild from the already source-hash-bound inline modules. Protected
    // catalogue/source lineage is independently checked by the authority port.
    validateLocalReadOnlyDossier(d,file=>{const name=Object.keys(READONLY_RUNTIME_FILES).find(k=>READONLY_RUNTIME_FILES[k]===file);assert(name);return Buffer.from(d.bundle.modules[name].source,'utf8');});
    const prefix=d.objective.jobName+'/executions/',leaf=d.objective.jobName.split('/').at(-1);assert.equal(typeof row.execution,'string');assert(row.execution.startsWith(prefix+leaf+'-'));assert.match(row.execution.slice(prefix.length),/^[a-z0-9-]+$/u);
  }
  assert.deepEqual(rows.map(r=>r.dossier.objective.purpose).sort(alphabetical),[...purposes].sort(alphabetical),'ONE_OF_EACH_PRE_PURPOSE');return rows;
}
export function validatePreparedReadOnlyJob(job,row,observedAt){
  validateReadOnlyNativeJob(job,row.dossier.objective);assert.equal(job.uid,row.uid,'PREPARATION_JOB_UID');
  assert.equal(job.executionCount,1,'SINGLE_COMPLETED_PRE_EXECUTION_REQUIRED');assert.match(job.generation,/^[1-9]\d*$/u);assert.equal(job.observedGeneration,job.generation);assert.equal(job.terminalCondition?.state,'CONDITION_SUCCEEDED');
  const latest=job.latestCreatedExecution;assert(latest);assert.equal(latest.deleteTime,undefined);assert(latest.name===row.execution||latest.name===row.execution.split('/').at(-1));assert.equal(latest.completionStatus,'EXECUTION_SUCCEEDED');
  const completed=Date.parse(latest.completionTime),observed=Date.parse(observedAt);assert(Number.isFinite(completed)&&Number.isFinite(observed)&&completed<=observed,'COMPLETED_PRE_BEFORE_BASELINE');return true;
}
