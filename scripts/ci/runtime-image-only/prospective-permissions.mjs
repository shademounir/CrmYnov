// Pure one-record permission interpretation. No pool contract, I/O, authority,
// historical rewrite, freshness claim or replacement preservation comparator.
import assert from 'node:assert/strict';
import{createHash}from'node:crypto';
import{digest}from'../pool-reconciliation/controlled-pool-contract-v1.mjs';
import{digest as historicalDigest}from'../readonly-probe/rc47-select-only-probe-core-v1.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),H=/^[a-f0-9]{64}$/u;
function pinnedJson(bytes,pin){assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576);assert(H.test(pin));assert.equal(hash(bytes),pin,'PROSPECTIVE_EVIDENCE_BYTES');const value=JSON.parse(bytes);assert(value&&Object.getPrototypeOf(value)===Object.prototype);return value;}
function fields(row,names){assert(row&&Object.getPrototypeOf(row)===Object.prototype);assert.deepEqual(Object.keys(row).sort((a,b)=>a.localeCompare(b,'en')),[...names].sort((a,b)=>a.localeCompare(b,'en')));assert(Object.values(Object.getOwnPropertyDescriptors(row)).every(d=>Object.hasOwn(d,'value')));}
function grants(rows){assert(Array.isArray(rows)&&rows.length===49,'EXACT_49_MANAGER_GRANTS');const seen=new Set(),counts={};for(const row of rows){fields(row,['permission','scope']);assert.equal(typeof row.permission,'string');assert(!seen.has(row.permission),'DUPLICATE_PERMISSION');seen.add(row.permission);assert(['NONE','CAMPUS','TEAM','OWN'].includes(row.scope),'NO_MANAGER_GLOBAL_GRANT');counts[row.scope]=(counts[row.scope]??0)+1;}assert.deepEqual(counts,{CAMPUS:26,NONE:20,OWN:1,TEAM:2});return counts;}
const sorted=rows=>rows.map(r=>({permission:r.permission,scope:r.scope})).sort((a,b)=>a.permission.localeCompare(b.permission,'en'));
export function composeProspectiveGeneralPermissionBaseline({historicalBaseline,observedPermissions,evidence,bindings}){
  assert.equal(historicalBaseline.targetMain,'8253024ea35cee6be5636cc6b10a88ae7e177377');
  for(const value of Object.values(bindings)){assert(H.test(value),'PINNED_INTERPRETATION_REQUIRED');}
  assert.equal(historicalBaseline.permissionSha256,bindings.historicalPermissionSha256);
  const decision=pinnedJson(evidence.decision,bindings.decisionSha256),configuration=pinnedJson(evidence.configuration,bindings.configurationSha256),current=pinnedJson(evidence.currentComparison,bindings.currentComparisonSha256);
  assert.equal(decision.executor,'Codex');assert.equal(decision.delegation,'crm-ynov-po-delegation-20261001');assert.equal(decision.humanInstructionSha256,bindings.humanInstructionSha256);
  assert.equal(decision.nature,'ONE_ROLE_CONFIGURATION_NOT_49_USER_ASSIGNMENTS');
  assert.equal(decision.noPermissionWrite,true);assert.equal(decision.historicalOriginAuditUnproved,true);assert.equal(decision.noHistoricalAuditFabricated,true);assert.equal(decision.prospectiveNotBackdated,true);assert.equal(decision.productionActivation,false);
  const target={kind:'ROLE',role:'MANAGER',campus:'GLOBAL',version:1};assert.deepEqual(decision.target,target);assert.deepEqual(configuration.report.target,target);assert.deepEqual(current.configuration,target);
  assert.equal(current.all49MatchCapturedAndProspectivelyRequalifiedConfiguration,true);assert.equal(current.noPermissionWrite,true);assert.equal(current.notCommonSqlSnapshot,true);assert.equal(current.completeNativeBeneficiariesProved,false);
  assert.equal(configuration.report.noPermissionMutation,true);assert.equal(configuration.report.configurationTargetGlobalIsNotUserGlobalScope,true);
  assert(Array.isArray(observedPermissions)&&observedPermissions.length===3,'ONLY_ONE_ADDITIONAL_CONFIGURATION');
  const matches=observedPermissions.filter(r=>r.kind==='ROLE'&&r.role==='MANAGER'&&r.campus==='GLOBAL');assert.equal(matches.length,1,'EXACT_ONE_MANAGER_CONFIGURATION');const manager=matches[0];
  // Existing diagnostics pin the canonical JSON string, not unquoted raw text.
  fields(manager,['id','kind','role','campus','version','grants']);assert.equal(manager.version,1);assert.equal(typeof manager.id,'string');assert.equal(digest(manager.id),bindings.managerIdSha256,'MANAGER_IDENTITY_CHANGED');
  const counts=grants(manager.grants);assert.equal(digest(manager.grants),bindings.managerGrantsSha256);assert.equal(decision.configurationGrantSha256,bindings.managerGrantsSha256);assert.equal(configuration.report.grantSha256,bindings.managerGrantsSha256);
  for(const rows of [configuration.report.grants,current.grants,decision.calculation.permissions]){assert(Array.isArray(rows)&&rows.length===49);assert.deepEqual(sorted(rows),sorted(manager.grants),'ONLY_EXPLICITLY_REQUALIFIED_GRANTS');}
  assert.deepEqual(current.scopeCounts,counts);assert.equal(decision.calculation.all49DenyOutsideCampusGlobalAndInactive,true);assert.equal(decision.calculation.notRealAuthenticatedSessionsOrMeasuredBeneficiaries,true);
  assert.deepEqual(decision.groups.map(g=>({scope:g.scope,count:g.count,decision:g.decision})),[{scope:'NONE',count:20,decision:'MAINTAIN_REFUSALS'},{scope:'CAMPUS',count:26,decision:'VALIDATE_PROSPECTIVELY'},{scope:'OWN',count:1,decision:'VALIDATE_PROSPECTIVELY'},{scope:'TEAM',count:2,decision:'VALIDATE_PROSPECTIVELY'}]);
  const rest=observedPermissions.filter(r=>r!==manager);assert.equal(historicalDigest(rest),historicalBaseline.permissionSha256,'ALL_HISTORICAL_PERMISSION_ROWS_MUST_REMAIN_IDENTICAL');
  const baseline=Object.fromEntries(['targetMain','campusId','expectedMailVersion','expectedMailBaseline','qualificationKey','settingsSha256','membershipSha256'].map(k=>[k,historicalBaseline[k]]));baseline.permissionSha256=historicalDigest(observedPermissions);
  return{baseline,interpretation:{schemaVersion:1,kind:'PROSPECTIVE_MANAGER_RECORD_INTERPRETATION_NOT_NATIVE_ACCEPTANCE',oldPermissionSha256:historicalBaseline.permissionSha256,prospectivePermissionSha256:baseline.permissionSha256,additionalConfigurations:1,additionalGrants:49,scopeCounts:counts,bindings:{...bindings},originalHistoricalBaselineUnchanged:true,allOtherPermissionRowsUnchanged:true,historicalOriginUnproved:true,noHistoricalAuditFabricated:true,currentFreshnessAsserted:false,sameSqlSnapshotClaimed:false,nativeAcceptance:false,activationAuthorized:false,noPermissionWrite:true}};
}
