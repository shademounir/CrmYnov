// CLI failure contract is tested without a dossier, native client, token or journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseDiagnosticDriverArguments,POOL_DRIVER_INPUTS} from '../pool-operational-driver-v2.mjs';
import {withDiagnosticAuthority,withDiagnosticPhase,diagnosticOf} from '../readonly-native-diagnostics-v1.mjs';
const common=['verify','--purpose','GENERAL_PRESERVATION_READ_ONLY_V1','--objective-id','synthetic','--dossier','not-opened','--jira-evidence','not-opened','--journal-dir','not-opened','--diagnostic-dir','not-opened'];
test('V2 requires separate explicit diagnostic directory while retaining V1 option validation',()=>{
  const parsed=parseDiagnosticDriverArguments(common);assert.equal(parsed.diagnosticDirectory,'not-opened');assert.equal(parsed.mode,'verify');
  assert.throws(()=>parseDiagnosticDriverArguments(common.slice(0,-2)),/DIAGNOSTIC_DIRECTORY_REQUIRED/u);
  assert.throws(()=>parseDiagnosticDriverArguments([...common,'--diagnostic-dir','other']),/DUPLICATE_DIAGNOSTIC_DIRECTORY/u);
  assert.throws(()=>parseDiagnosticDriverArguments([...common,'--retry','yes']));
});
test('CLI emits one real newline JSON refusal and keeps historical nonzero refusal code',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../pool-operational-driver-v2.mjs',import.meta.url))],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert(result.stderr.endsWith('\n'));assert(!result.stderr.endsWith('\\n'));
  // Node's existing SQLite ExperimentalWarning is separate stderr text, never
  // a diagnostic field. Require exactly one complete JSON protocol record.
  const records=result.stderr.split(/\r?\n/u).filter(line=>line.startsWith('{'));assert.equal(records.length,1);
  const value=JSON.parse(records[0]);assert.equal(value.state,'REFUSED');assert.equal(value.commandCompleted,true);assert.equal(value.operationOutcome,'REFUSED');assert.equal(value.diagnosticAvailable,true);assert.equal(value.resumeAuthorized,false);assert.equal(value.automaticRetryAllowed,false);
});
test('V2 source binding is additive and never reuses the old exact file list',()=>{
  for(const name of ['pool-native-transaction-v1.mjs','pool-native-transaction-v2.mjs','readonly-native-diagnostics-v1.mjs','pool-operational-driver-v1.mjs','pool-operational-driver-v2.mjs'])assert(POOL_DRIVER_INPUTS.includes('scripts/ci/pool-reconciliation/'+name));
  assert(POOL_DRIVER_INPUTS.includes('scripts/ci/operational-driver-v3.mjs'));
  const source=fs.readFileSync(new URL('../pool-operational-driver-v2.mjs',import.meta.url),'utf8');
  assert(source.includes('HISTORICAL_GENERAL_UNKNOWN_JOURNAL_REFUSED_BEFORE_OPEN'));assert(source.indexOf('HISTORICAL_GENERAL_UNKNOWN_JOURNAL_REFUSED_BEFORE_OPEN')<source.indexOf('openReadOnlyTransactionJournal({'));
  assert(source.includes("assert.deepEqual(localSource(),source,'LOCAL_SOURCE_DRIFT')"));assert(source.includes('authorizeReadOnlyDriver'));
});
test('the driver uses one diagnostic authority wrapper for initial and repeated authority checks',async()=>{
  const source=fs.readFileSync(new URL('../pool-operational-driver-v2.mjs',import.meta.url),'utf8');
  assert(source.includes('const authorizeFresh=withDiagnosticAuthority(async()=>'));
  assert(source.includes('await authorizeReadOnlyDriver({github'));
  assert(source.includes('},{diagnostic:inputs.diagnostic,saveDiagnostic:inputs.saveDiagnostic});'));
  const saved=[],context={correlationId:'01234567-89ab-cdef-0123-456789abcdef',objectiveId:'synthetic-general',objectiveSha256:'a'.repeat(64),stage:'RUN'};
  let calls=0;const wrapped=withDiagnosticAuthority(async()=>{calls++;throw Error('SYNTHETIC_SECRET');},{diagnostic:context,clock:()=>1793260800000,saveDiagnostic:async record=>saved.push(record)});
  for(let index=0;index<2;index++)await assert.rejects(wrapped(),error=>{const d=diagnosticOf(error);assert.equal(d.phase,'AUTHORITY');assert.equal(d.objectiveId,context.objectiveId);assert.equal(d.stage,'RUN');assert.equal(d.correlationId,context.correlationId);assert.equal(d.transportInvoked,false);assert.equal(d.diagnosticPersisted,true);assert(!JSON.stringify(d).includes('SYNTHETIC_SECRET'));return true;});
  assert.equal(calls,2);assert.equal(saved.length,2);
});
test('driver validation failures after input binding retain their known context without leaking the exception',async()=>{
  const source=fs.readFileSync(new URL('../pool-operational-driver-v2.mjs',import.meta.url),'utf8');assert(source.includes("phase:'VALIDATION',reason:'VALIDATION_REFUSED'})()"));
  const diagnostic={correlationId:'01234567-89ab-cdef-0123-456789abcdef',objectiveId:'synthetic-general',objectiveSha256:'a'.repeat(64),stage:'OBSERVE_RUN'};
  let saved;
  const run=withDiagnosticPhase(async()=>{throw Object.assign(Error('SYNTHETIC_SECRET'),{body:'SYNTHETIC_SECRET'});},{diagnostic,saveDiagnostic:async value=>{saved=value;},clock:()=>1793260800000,phase:'VALIDATION',reason:'VALIDATION_REFUSED'});
  await assert.rejects(run(),error=>{const d=diagnosticOf(error);assert.equal(d.stage,'OBSERVE_RUN');assert.equal(d.objectiveId,diagnostic.objectiveId);assert.equal(d.phase,'VALIDATION');assert(!JSON.stringify(d).includes('SYNTHETIC_SECRET'));return true;});assert(saved);
});
