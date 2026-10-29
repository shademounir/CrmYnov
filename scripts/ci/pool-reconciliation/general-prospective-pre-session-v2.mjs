// Additive preclaim boundary. AUTH_ONLY has no Cloud Run/Logging client, no
// private key, SQL, RUN claim or RUN INTENT. No executable CLI on import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {byteHash,digest} from './controlled-pool-contract-v1.mjs';
import {dataFields} from './general-prospective-pre-authority-v1.mjs';
import {validateProspectiveConsumerInputs} from './general-prospective-pre-session-v1.mjs';
import {AUTH_HUMAN_SHA256,AUTH_SDK_CACHE_HUMAN_SHA256,AUTH_PREFLIGHT_DRIVER_INPUTS,validateAuthOnlyRecord,validateAuthHumanAndQualification,validateSdkCacheClarification,authorizeAuthOnlyPreflight} from './general-auth-preflight-authority-v1.mjs';
import {AUTH_FACTORY_SHA256,runOfficialSdkAuthOnly} from '../readonly-probe/official-sdk-auth-preflight-v1.mjs';
import {createReadOnlyGithubReader} from './pool-driver-github-v1.mjs';
import {POOL_OFFICIAL_GIT,readPoolPrivateFile} from './pool-operational-driver-v1.mjs';
import {fixedToolEnvironment} from '../readonly-probe/probe-driver-github-v1.mjs';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
const OUT='C:/Crm Ynov/output/casablanca-pilot-20261022/';
export const AUTH_ONLY_EVIDENCE_DIRECTORY=OUT+'auth-preflight-integration-20261029-v1';
const HUMAN=AUTH_ONLY_EVIDENCE_DIRECTORY+'/HUMAN-AUTHORITY.json';
const HISTORICAL=Object.freeze([
  {path:OUT+'runtime-pre-dossiers-20261028-v1/general/single-use-journal/pool-native-transactions.sqlite',sha256:'6c3816eea737aa035000b42d249e1cc697ddc4e666d3d97c0b5bdf2873f85450'},
  {path:OUT+'native-runtime-pre-session-20261028-v1/general/RUN-1-JOURNAL-SNAPSHOT.sqlite',sha256:'6c3816eea737aa035000b42d249e1cc697ddc4e666d3d97c0b5bdf2873f85450'},
  {path:OUT+'general-prospective-pre-native-20261029-v1/prospective-0d48bd85-8b95-f624-e32c-560406e6ddd8-CLAIM.json',sha256:'3ccfd96471f27c0ab8b36f07891e5974ec498cd574bb9d43ebf34a387dc6faa2'},
]);
const QUAL_STATUS='LOCAL_AUTH_ONLY_WINDOWS_BUDGET_AND_PRECLAIM_BOUNDARY_ROOT_STATIC_PASS_NOT_NATIVE_ACCEPTANCE';
const epoch=()=>Math.floor(performance.timeOrigin+performance.now());
function durableNew(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function canonicalDirectory(directory){assert(path.isAbsolute(directory));assert.equal(fs.realpathSync(directory),path.resolve(directory));assert(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink());}
function historicalGuard(){for(const file of HISTORICAL){assert.equal(byteHash(readPoolPrivateFile(file.path)),file.sha256,'OLD_CLOSED_EVIDENCE_BYTES_CHANGED');}}
function reusableEvidenceGuard(inputs){
  validateProspectiveConsumerInputs(inputs);const index=JSON.parse(inputs.cutoverIndexBytes);
  for(const file of [...index.references,...index.protectedConsumerModules]){assert.equal(byteHash(readPoolPrivateFile(file.path)),file.sha256,'REUSABLE_CONSUMER_BYTES_CHANGED');}
}
function localSource(root,record){
  canonicalDirectory(root);assert(!Object.keys(process.env).some(key=>/^GIT_/iu.test(key)));assert.equal(fs.realpathSync(POOL_OFFICIAL_GIT),path.win32.normalize(POOL_OFFICIAL_GIT));
  const git=args=>execFileSync(POOL_OFFICIAL_GIT,['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576,env:fixedToolEnvironment(process.env)}).trim();
  assert.equal(git(['status','--porcelain','--untracked-files=all']),'','CLEAN_AUTH_SOURCE_REQUIRED');
  return{commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),head:record.source.head,pr:record.source.pr,clean:true,
    files:AUTH_PREFLIGHT_DRIVER_INPUTS.map(relative=>({path:relative,sha256:byteHash(readPoolPrivateFile(path.join(root,relative)))}))};
}
export function validateAuthSourceQualification(bytes,source){
  assert(Buffer.isBuffer(bytes));const qualification=JSON.parse(bytes);assert.equal(qualification.status,QUAL_STATUS);
  assert.equal(qualification.base,'fd9127d8a7bb04ca191caf4ba83a512aa542004b');
  assert.equal(qualification.sourceFrozen,true);assert.equal(qualification.allOldSourcesUnchanged,true);
  for(const key of ['sdkCalls','nativeCalls','productionSqlQueries','dockerCalls']){assert.equal(qualification[key],0);}
  assert.equal(qualification.oldUnknownAndClosedClaimsUnchanged,true);assert.equal(qualification.newRunCapacityArmed,false);
  assert.equal(qualification.rootTotals.fail,0);assert.equal(qualification.rootTotals.cancelled,0);assert.equal(qualification.rootTotals.skipped,3);
  assert(Number.isSafeInteger(qualification.rootTotals.pass)&&qualification.rootTotals.pass>0);
  for(const key of ['fail','cancelled','skipped']){assert.equal(qualification.targetedTests[key],0);}
  assert(Number.isSafeInteger(qualification.targetedTests.pass)&&qualification.targetedTests.pass>0);
  assert.deepEqual(qualification.stages.map(stage=>stage.name),['ROOT-SYNTHETIC','REPOSITORY-STATIC-lint','REPOSITORY-STATIC-type-check','REPOSITORY-STATIC-build']);
  assert(qualification.stages.every(stage=>stage.exitCode===0&&stage.errorCode===null));
  assert.equal(qualification.humanAuthority.sha256,AUTH_HUMAN_SHA256);assert.equal(qualification.humanSdkStandardCacheClarification.sha256,AUTH_SDK_CACHE_HUMAN_SHA256);assert(Array.isArray(qualification.sources));
  assert.equal(qualification.sourceCount,qualification.sources.length);assert.equal(new Set(qualification.sources.map(file=>file.path)).size,qualification.sources.length);
  for(const file of source.files){const rows=qualification.sources.filter(row=>row.path===file.path);assert.equal(rows.length,1);assert.equal(rows[0].sha256,file.sha256,'AUTH_SOURCE_QUALIFICATION_BINDING');}
  return qualification;
}
function finalInvariants(input,authority,source){
  const {record,jiraBytes,humanAuthorityBytes,qualificationBytes,consumerInputs,root}=input;
  validateAuthOnlyRecord(record,epoch());assert.equal(digest(record),authority.receipt.authorityRecordSha256);
  assert.equal(byteHash(jiraBytes),authority.receipt.jiraObservationSha256);validateAuthHumanAndQualification({record,humanAuthorityBytes,qualificationBytes});
  assert.equal(byteHash(readPoolPrivateFile(HUMAN)),AUTH_HUMAN_SHA256);historicalGuard();reusableEvidenceGuard(consumerInputs);
  validateSdkCacheClarification(readPoolPrivateFile(AUTH_ONLY_EVIDENCE_DIRECTORY+'/HUMAN-SDK-STANDARD-CACHE-AUTHORITY.json'));
  for(const file of source.files){assert.equal(byteHash(readPoolPrivateFile(path.join(root,file.path))),file.sha256,'AUTH_LOCAL_SOURCE_DRIFT');}
  assert.equal(byteHash(readPoolPrivateFile(path.join(root,'scripts/ci/readonly-probe/rc47-probe-official-auth-v1.mjs'))),AUTH_FACTORY_SHA256);
  assertAuthorityCurrent(authority,epoch());
}
const outcome=(state,extra={})=>({schemaVersion:1,kind:'GENERAL_COMPLETE_AUTH_ONLY_SESSION_FIN_V1',state,...extra,
  runAuthorized:false,gcpResourceAccessAuthorized:false,cloudRunOrLoggingResourceCalls:0,runClaimsCreated:0,runIntentsCreated:0,
  runPosts:0,sqlQueries:0,oldGeneralState:'UNKNOWN',oldLedgerReplayed:false,oldClosedClaimsUnchanged:true,
  nativeResourceOrRunAcceptance:false,tokenReferenceReleaseScope:'ADAPTER_JAVASCRIPT_ONLY',officialSdkMemoryOnlyGuaranteed:false,
  globalPreProved:false,runtimeDeploymentAuthorized:false,sheetsActivated:false,canRetry:false});
// The public actual entry has no injected execution, auth, time, environment,
// governance, resource or mode callback. The real SDK path is built only after
// concrete protected source/Jira/lease verification and the AUTH-only wx intent.
async function executeAuthOnlyAttempt(steps){
  let intentCreated=false,report;
  try{
    const authority=await steps.prepare();steps.intent(authority);intentCreated=true;
    report=await steps.authenticate(authority);steps.revalidate(authority);
    const result=outcome(report.authenticationChainValidated?'AUTH_ONLY_COMPLETE_NO_RUN_AUTHORITY':'AUTH_ONLY_TERMINAL_STOP',{
      authority:authority.receipt,authentication:report,tokenReferencesReleased:true,physicalStringErasureAsserted:false,
      sourceAndClosedEvidenceRevalidatedAfterTrial:true,nextRequired:'SEPARATE_RUN_AUTHORITY_AND_QUALIFIED_RIGHTS_RESOURCE_ADAPTER'});
    steps.finish(result);return result;
  }catch{
    const result=outcome(intentCreated?'AUTH_ONLY_ATTEMPT_CLOSED_INCOMPLETE':'AUTH_ONLY_REFUSED_BEFORE_ATTEMPT',{
      failureCode:intentCreated?'AUTH_ONLY_FINAL_REVALIDATION_OR_PERSISTENCE_REFUSED':'AUTH_ONLY_INPUT_GOVERNANCE_OR_ALREADY_CONSUMED_REFUSED',
      authentication:report??null,tokenReferencesReleased:true,physicalStringErasureAsserted:false});
    if(intentCreated){try{steps.stop(result);}catch{result.evidencePersistenceFailed=true;}}return result;
  }
}
export async function runProspectiveAuthPreflightV2(input){
  let guard;
  const steps={async prepare(){
    dataFields(input,['root','record','jiraBytes','humanAuthorityBytes','qualificationBytes','consumerInputs']);
    const {root,record,jiraBytes,humanAuthorityBytes,qualificationBytes,consumerInputs}=input;
    assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
    validateAuthOnlyRecord(record,epoch());validateAuthHumanAndQualification({record,humanAuthorityBytes,qualificationBytes});
    validateAuthSourceQualification(qualificationBytes,record.source);canonicalDirectory(AUTH_ONLY_EVIDENCE_DIRECTORY);
    const intentPath=path.join(AUTH_ONLY_EVIDENCE_DIRECTORY,'AUTH-ONLY-ATTEMPT-INTENT.json');assert(!fs.existsSync(intentPath),'AUTH_ONLY_ATTEMPT_ALREADY_CONSUMED');
    historicalGuard();reusableEvidenceGuard(consumerInputs);const source=localSource(root,record);assert.deepEqual(source,{...record.source,clean:true});
    const github=createReadOnlyGithubReader();
    const authority=await authorizeAuthOnlyPreflight({github,record,jiraBytes,humanAuthorityBytes,qualificationBytes,localSource:source,clock:epoch});
    guard=()=>finalInvariants(input,authority,source);guard();return authority;
  },intent(authority){
    const {record}=input;const intentPath=path.join(AUTH_ONLY_EVIDENCE_DIRECTORY,'AUTH-ONLY-ATTEMPT-INTENT.json');
    durableNew(intentPath,{schemaVersion:1,kind:'ONE_AUTH_ONLY_ATTEMPT_INTENT_NOT_A_RUN_CLAIM',at:new Date(epoch()).toISOString(),
      authorityRecordSha256:digest(record),humanAuthorityReceiptSha256:AUTH_HUMAN_SHA256,sdkCacheClarificationSha256:AUTH_SDK_CACHE_HUMAN_SHA256,driverCommit:record.source.commit,
      expiresAt:authority.receipt.expiresAt,runAuthorized:false,resourceAccessAuthorized:false,canRetry:false});
  },authenticate:authority=>runOfficialSdkAuthOnly({leaseExpiresAt:Date.parse(authority.receipt.expiresAt),assertCurrent:guard}),
  revalidate(){guard();},finish:result=>durableNew(path.join(AUTH_ONLY_EVIDENCE_DIRECTORY,'AUTH-ONLY-FIN.json'),result),
  stop:result=>durableNew(path.join(AUTH_ONLY_EVIDENCE_DIRECTORY,'AUTH-ONLY-STOP.json'),result)};
  return executeAuthOnlyAttempt(steps);
}
export async function simulateAuthOnlySession({syntheticOnly,steps}){
  assert.equal(syntheticOnly,true);const result=await executeAuthOnlyAttempt(steps);return{...result,syntheticOnly:true,nativeAuthority:false};
}
// Future RUN cannot piggyback on the current AUTH-only record, the old closed
// capability or a documentary IAM matrix. No GCP client is constructed here.
export async function runProspectiveGeneralPreV2(){throw new Error('SEPARATE_RUN_AUTHORITY_AND_QUALIFIED_RIGHTS_RESOURCE_ADAPTER_REQUIRED');}
// Protocol-only seam used by synthetic qualification: current real AUTH_ONLY
// exits before rights/resources/arming. Never an actual authorization adapter.
export async function simulateProspectivePreclaimBoundary({syntheticOnly,mode,stages}){
  assert.equal(syntheticOnly,true);assert(['AUTH_ONLY','SYNTHETIC_FUTURE_RUN'].includes(mode));let armed=false;
  try{
    await stages.inputsSourceJiraLease();const authentication=await stages.authentication();assert.equal(authentication.validated,true);
    if(mode==='AUTH_ONLY'){return{state:'AUTH_ONLY_END_BEFORE_RESOURCES',armed:false,runPosts:0};}
    const permissions=await stages.rightsAndResourceChecks();assert.equal(permissions.coverage,'COMPLETE_PROTECTED_AND_OBSERVED');
    await stages.revalidation();await stages.claimAndDurableIntent();armed=true;await stages.singlePost();
    return{state:'SYNTHETIC_ONE_POST',armed,runPosts:1,canRetry:false};
  }catch{return{state:armed?'SYNTHETIC_TERMINAL_AFTER_ARMING':'SYNTHETIC_STOP_BEFORE_ARMING',armed,canRetry:false};}
}
