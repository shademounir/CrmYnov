// A protected reviewed preparation receipt, not a local boolean or an empty catalog.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=/^[a-f0-9]{64}$/u;
const kinds=['POOL','LEDGER','GENERAL','PERMISSIONS','JOB_INVENTORY','RECOVERABILITY','ROLLBACK'];
export function validateImagePreparation({bytes,entry,dossier,readEvidence,now}){
  assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576);assert.equal(typeof readEvidence,'function');
  const sha=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(sha(bytes),entry.preparationReceiptSha256);assert.equal(sha(bytes),dossier.preparationReceiptSha256);
  const p=JSON.parse(bytes);assert.equal(p.schemaVersion,1);assert.equal(p.kind,'RC48_IMAGE_ONLY_PREPARATION_QUALIFIED_V1');assert.equal(p.objectiveId,entry.id);
  const at=Date.parse(p.qualifiedAt),expires=Date.parse(p.expiresAt);assert(Number.isSafeInteger(now)&&at<=now&&now<expires&&expires-at<=1800000,'CURRENT_IMAGE_PREPARATION_REQUIRED');
  assert.equal(p.applicationMain,'8253024ea35cee6be5636cc6b10a88ae7e177377');assert.equal(p.schemaCompatibilityQualifiedForImageChange,true);
  assert.equal(p.generalIdentity,'crm_runtime');assert.equal(p.ledgerIdentity,'crm_migrator');assert.equal(p.sameSqlSnapshotClaimed,false);
  assert.equal(p.historicalPermissionOriginUnproved,true);assert.equal(p.prospectivePermissionDecisionSha256,dossier.prospectivePermissionDecisionSha256);assert(hash.test(p.prospectivePermissionDecisionSha256));
  assert.equal(p.permissionConfigurationFreshlyCompared,true);assert.equal(p.preservationQualified,true);assert.equal(p.unknownPriorMutation,false);
  assert.equal(p.rollback.kind,'IMAGE_ONLY');assert.equal(p.rollback.compatible,true);assert.equal(p.rollback.databaseRestore,false);assert.equal(p.rollback.preserveInterveningWrites,true);assert.equal(p.rollback.afterSheetsActivationAuthorized,false);
  assert.equal(p.backupRecoverabilityQualified,true);assert.equal(p.backupCreated,false,'BACKUP_NOT_PREMATURE');
  assert.deepEqual(p.jobs,dossier.preservedJobs);assert.deepEqual(p.schedulers,dossier.preservedSchedulers);
  assert(Array.isArray(p.evidence)&&p.evidence.length===kinds.length);assert.deepEqual(p.evidence,dossier.preparationEvidence);
  assert.deepEqual(p.evidence.map(e=>e.kind).sort((a,b)=>a.localeCompare(b,'en')),[...kinds].sort((a,b)=>a.localeCompare(b,'en')));
  for(const e of p.evidence){assert(hash.test(e.sha256));assert.equal(typeof e.path,'string');assert(e.path.endsWith('.json')&&!/private-key|\.private\.json/iu.test(e.path));const value=readEvidence(e.path);assert(Buffer.isBuffer(value)&&value.length<=1048576);assert.equal(sha(value),e.sha256,'PROTECTED_PREPARATION_EVIDENCE_CHANGED');}
  return Object.freeze({qualifiedAt:p.qualifiedAt,expiresAt:p.expiresAt,preparationReceiptSha256:sha(bytes),prospectivePermissionDecisionSha256:p.prospectivePermissionDecisionSha256,rollback:p.rollback});
}
