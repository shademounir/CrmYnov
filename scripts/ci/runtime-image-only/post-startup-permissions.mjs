// Exact RC48 startup projection, not authority to write permissions or accept an
// arbitrary current POST. No runtime source/old baseline is changed by this module.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {imageJournalDigest as digest} from './journal.mjs';
export const RC48_STARTUP_SOURCE=Object.freeze({commit:'8253024ea35cee6be5636cc6b10a88ae7e177377',files:Object.freeze({
 'apps/api/src/permissions/dynamic-service.ts':'7092be3c333d1621e0181de13bec6cd56a5ad62e8e25ca6de0f04b3aee47cf28',
 'apps/api/src/permissions/dynamic-repository.ts':'575bda098a18f735bdbae78cb8de03c55fa1da6184598eaff3e5b3c877154dab',
 'apps/api/src/permissions/dynamic-contract.ts':'ee781853ba5b794c92759d298abc01f11258717f5a024634501d981e85dd54d7',
 'apps/api/src/permissions/view-grants.ts':'e5038dbbb00bdabbca8e7c8c0d12fcaaa53a472d045259edffd614f5dd2da4ed',
 'apps/api/src/permissions/permission-fence.ts':'e5081e5587b3201e984d5860acb367d63a5260148d19e490df90ca5d9110a48d',
})});
const views=['lead.views.view','lead.views.share.team','lead.views.share.campus','lead.views.revoke.own','lead.views.revoke.team','lead.views.revoke.campus'];
const keys=['lead.view','lead.create','lead.edit','lead.qualification.update','lead.assign','lead.reassign.request','lead.reassign.approve','lead.close.request','lead.close.approve','lead.tags.assign','lead.collaborators.manage','lead.tags.manage','lead.references.view','lead.references.manage','lead.references.archive','interaction.create','interaction.view','reminder.manage','appointment.manage','import.view','import.execute','import.confirm','import.review.resolve','import.report.export','reporting.view','reporting.pilotage.view','reporting.export','reporting.global.view','users.view','users.create','users.edit','users.disable','users.roles.assign','roles.permissions.view','roles.permissions.manage','settings.campus.manage','settings.global.manage','audit.view','audit.export','chat.use','chat.broadcast','notification.manage','telephony.free-call.create',...views];
const own=(o,k)=>Object.hasOwn(o,k),sorted=a=>[...a].sort((a,b)=>a.localeCompare(b,'en'));
function fields(o,names){assert(o&&Object.getPrototypeOf(o)===Object.prototype);assert.deepEqual(sorted(Object.keys(o)),sorted(names),'STARTUP_PERMISSION_FIELDS');assert(Object.values(Object.getOwnPropertyDescriptors(o)).every(d=>own(d,'value')));}
function target(row){assert(['ROLE','CEILING'].includes(row.kind));assert(row.kind==='CEILING'?row.role==='*':['SUPER_ADMIN','ADMIN','MANAGER','ADMISSIONS','AUDITOR'].includes(row.role));assert(typeof row.campus==='string'&&/^[a-zA-Z0-9_-]{2,80}$/u.test(row.campus));}
function validateGrants(g,row){
 assert.equal(Object.keys(g).length,keys.length);
 for(const [k,v] of Object.entries(g)){
  assert(keys.includes(k),'STARTUP_UNKNOWN_PERMISSION');const globalOnly=['settings.global.manage','reporting.global.view'].includes(k);
  const allowed=['users.edit','audit.export'].includes(k)?['NONE']:globalOnly?['NONE','GLOBAL']:k.startsWith('lead.')||k.startsWith('interaction.')||['reporting.view','reporting.pilotage.view','reporting.export'].includes(k)?['NONE','OWN','TEAM','CAMPUS','GLOBAL']:['NONE','CAMPUS','GLOBAL'];
  assert(allowed.includes(v),'STARTUP_INVALID_SCOPE');assert(!(row.campus!=='GLOBAL'&&v==='GLOBAL'));assert(!(globalOnly&&row.campus!=='GLOBAL'&&v!=='NONE'));
  const mutation=!(k.endsWith('.view')||k.endsWith('.export'));assert(!(row.role==='AUDITOR'&&mutation&&v!=='NONE'));
 }
}
function normalized(g,row){
 const names=sorted(Object.keys(g));const catalogues=[keys,keys.filter(k=>k!=='reporting.pilotage.view')].flatMap(base=>{const v2=base.filter(k=>k!=='telephony.free-call.create'),beforeViews=v2.filter(k=>!views.includes(k));return[base,base.filter(k=>k!=='lead.qualification.update'),v2,v2.filter(k=>k!=='lead.qualification.update'),beforeViews,beforeViews.filter(k=>k!=='lead.qualification.update')];});
 assert(catalogues.some(c=>digest(sorted(c))===digest(names)),'STARTUP_INCOMPLETE_CATALOGUE');const n={...Object.fromEntries(keys.map(k=>[k,'NONE'])),...g};
 if(!own(g,'reporting.pilotage.view')){const v=g['reporting.view'];n['reporting.pilotage.view']=v==='CAMPUS'||v==='GLOBAL'?row.kind==='CEILING'||row.role==='SUPER_ADMIN'?v:['MANAGER','ADMIN'].includes(row.role)?v==='GLOBAL'?'CAMPUS':v:'NONE':'NONE';}
 validateGrants(n,row);return n;
}
export function verifyRc48StartupRuleSources(readSource){
 assert.equal(typeof readSource,'function','STARTUP_SOURCE_READER_REQUIRED');
 for(const [file,pin] of Object.entries(RC48_STARTUP_SOURCE.files)){const b=readSource(file,RC48_STARTUP_SOURCE.commit);assert(Buffer.isBuffer(b));assert.equal(createHash('sha256').update(b).digest('hex'),pin,'RC48_STARTUP_SOURCE_CHANGED');}
 return digest(RC48_STARTUP_SOURCE);
}
export function projectRc48StartupPermissions(rows){
 assert(Array.isArray(rows)&&rows.length>0&&rows.length<=100);const seen=new Set(),changes=[];
 const projected=rows.map(original=>{
  fields(original,['id','kind','role','campus','version','grants']);const row=structuredClone(original);target(row);assert(typeof row.id==='string'&&!seen.has(row.id));seen.add(row.id);assert(Number.isSafeInteger(row.version)&&row.version>=1);assert(Array.isArray(row.grants));
  const grants={};for(const r of row.grants){fields(r,['permission','scope']);assert(typeof r.permission==='string'&&!own(grants,r.permission));grants[r.permission]=r.scope;}
  const missing=['lead.qualification.update','telephony.free-call.create','reporting.pilotage.view'].filter(k=>!own(grants,k));
  if(missing.length===0){validateGrants(grants,row);return row;}
  const next=normalized(grants,row),scope=row.kind==='CEILING'||row.role==='SUPER_ADMIN'?row.campus==='GLOBAL'?'GLOBAL':'CAMPUS':row.role==='ADMIN'?'CAMPUS':'NONE';
  for(const k of ['lead.qualification.update','telephony.free-call.create']){if(!own(grants,k)){next[k]=scope;}}
  validateGrants(next,row);row.version+=1;row.grants=sorted(Object.keys(next)).map(permission=>({permission,scope:next[permission]}));
  changes.push({configurationId:row.id,fromVersion:original.version,toVersion:row.version,missingKeys:missing,priorGrantsSha256:digest(original.grants),expectedGrantsSha256:digest(row.grants),expectedAuditReason:'CATALOGUE_UPGRADE',auditObserved:false});return row;
 });
 return {permissions:projected,changes,ruleSourceSha256:digest(RC48_STARTUP_SOURCE),managerExisting49Preserved:rows.filter(r=>r.role==='MANAGER'&&r.grants.length===49).every(r=>digest(projected.find(p=>p.id===r.id))===digest(r)),permissionEpochNotInGeneralQueryScope:true,epochOrAuditAbsenceOfChangeNotClaimed:true};
}
