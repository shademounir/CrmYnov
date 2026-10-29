// Pure proposal only. This file has no client, credential, transport or execution capability.
import assert from 'node:assert/strict';
import {digest} from './controlled-pool-contract-v1.mjs';

export const GENERAL_INCIDENT = Object.freeze({
  objectiveId: 'rc48-general-pre-20261028-147f390728',
  job: 'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-pre-20261028-147f390728',
  uid: '6333afa0-3af3-4916-9aa1-e1093ce0bea0',
  runIntentAt: '2026-10-28T15:58:51.562Z',
  knownCreateOperation: 'projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/26310575-b13a-4eeb-9eb4-26a5c8dbcab3',
  snapshotSha256: '6c3816eea737aa035000b42d249e1cc697ddc4e666d3d97c0b5bdf2873f85450',
});
const project='projects/crmynov-prod-n7x4q2', location=project+'/locations/europe-west1';
const start='2026-10-28T15:55:00Z', end='2026-10-28T16:15:00Z';
const method=(service,http,apiMethod,resource,fields,conditions=[])=>({service,http,apiMethod,resource,fields,conditions,semantic:'READ_ONLY',automaticRetry:false});

export function makeGeneralHistoricalSearchPlan(incident) {
  assert.deepEqual(incident,GENERAL_INCIDENT,'EXACT_EXISTING_INCIDENT_REQUIRED');
  const filter=['timestamp>="'+start+'"','timestamp<="'+end+'"','protoPayload.serviceName="run.googleapis.com"','protoPayload.methodName="google.cloud.run.v2.Jobs.RunJob"',
    '(protoPayload.resourceName="'+incident.job+'" OR protoPayload.request.name="'+incident.job+'" OR resource.labels.job_name="crm-prod-preservation-pre-20261028-147f390728")'].join(' AND ');
  const methods=[
    method('run.googleapis.com','GET','google.cloud.run.v2.Jobs.GetJob',incident.job,['name','uid','etag','generation','executionCount','latestCreatedExecution','deleteTime']),
    method('run.googleapis.com','GET','google.cloud.run.v2.Executions.ListExecutions',incident.job+'/executions',['name','uid','job','createTime','startTime','completionTime','deleteTime','expireTime','nextPageToken'],['pageSize=100','showDeleted=true','same query across pages','finish all pages or mark bounded/incomplete']),
    method('run.googleapis.com','GET','google.cloud.run.v2.Executions.GetExecution',incident.job+'/executions/{candidateName}',['name','uid','job','createTime','startTime','completionTime','deleteTime','expireTime','conditions','taskCount','retriedCount'],['candidate name discovered under the exact existing job only','metadata does not alone prove original-request attribution']),
    method('run.googleapis.com','GET','google.cloud.run.v2.Tasks.ListTasks',incident.job+'/executions/{candidateName}/tasks',['name','index','deleteTime','vpcAccess','serviceAccount','timeout','retried','conditions','containers.image','containers.resources','nextPageToken'],['only candidate execution under the exact job','reuse protected readOnlyTaskNetworkRequest: pageSize=2, showDeleted=true; do not relax one-task/no-retry/native-network checks','if pagination or missing task prevents existing validator, record gap rather than claim acceptance']),
    method('run.googleapis.com','GET','google.longrunning.Operations.ListOperations',location+'/operations',['name','done','error.code','metadata.@type','metadata.name','metadata.uid','metadata.createTime','metadata.target','metadata.verb','response.@type','response.name','response.uid','nextPageToken'],['regional collection only; no wildcard region','standard filter only if supported; UNIMPLEMENTED/unsupported filter is a coverage gap, not a retry fallback','persist only candidates linked to the exact job/time; do not persist other jobs']),
    method('run.googleapis.com','GET','google.longrunning.Operations.GetOperation',location+'/operations/{candidateId}',['name','done','error.code','metadata.@type','metadata.name','metadata.uid','metadata.target','metadata.createTime','response.@type','response.name','response.uid'],['candidate obtained from bounded list/audit evidence','exclude known CREATE operation from RUN candidates']),
    {...method('logging.googleapis.com','POST','google.logging.v2.LoggingServiceV2.ListLogEntries','v2/entries:list',['timestamp','receiveTimestamp','insertId','logName','operation.id','operation.first','operation.last','protoPayload.serviceName','protoPayload.methodName','protoPayload.resourceName','protoPayload.status.code','protoPayload.request.name','protoPayload.response.name','protoPayload.response.uid','nextPageToken'],['resourceNames limited to '+project+' or its same-project bucket views discovered in configuration','exact fixed audit filter below','hash principal identity locally when attribution comparison is needed; never persist full authenticationInfo','continue when entries=[] and nextPageToken is nonempty; only absent nextPageToken ends complete pagination','HTTP POST is a log read, not Jobs.RunJob']),temporaryIdentityComparisonFields:['protoPayload.authenticationInfo.principalEmail','protoPayload.authenticationInfo.principalSubject'],persistIdentity:'SHA256 comparison only; no raw identity or full authenticationInfo in receipts'},
    method('cloudresourcemanager.googleapis.com','GET','google.cloud.resourcemanager.v3.Projects.GetProject',project,['name','parent','projectId']),
    method('cloudresourcemanager.googleapis.com','POST','google.cloud.resourcemanager.v3.Projects.GetIamPolicy',project+':getIamPolicy',['version','etag','auditConfigs','bindings.role','bindings.condition','bindings.members'],['options.requestedPolicyVersion=3','only current account membership comparison persisted, no full member directory']),
    method('cloudresourcemanager.googleapis.com','POST','google.cloud.resourcemanager.v3.Projects.TestIamPermissions',project+':testIamPermissions',['permissions'],['test only listed read permissions; no granting role or permission']),
    method('cloudresourcemanager.googleapis.com','GET','google.cloud.resourcemanager.v3.Folders.GetFolder','{directProjectAncestorFolder}',['name','parent'],['only ancestry returned for the exact project; depth<=5; no search/list of unrelated folders']),
    method('cloudresourcemanager.googleapis.com','POST','google.cloud.resourcemanager.v3.Folders.GetIamPolicy','{directProjectAncestorFolder}:getIamPolicy',['version','etag','auditConfigs'],['only exact discovered project ancestry; no unrelated folder']),
    method('cloudresourcemanager.googleapis.com','POST','google.cloud.resourcemanager.v3.Organizations.GetIamPolicy','{directProjectAncestorOrganization}:getIamPolicy',['version','etag','auditConfigs'],['only exact discovered project ancestry; denial becomes an explicit inherited-configuration gap']),
    method('logging.googleapis.com','GET','google.logging.v2.ConfigServiceV2.ListSinks',project+'/sinks',['name','destination','filter','disabled','exclusions','includeChildren','interceptChildren','createTime','updateTime','nextPageToken'],['include ancestor routing metadata via supported in_scope("ALL") filter; do not query destination outside project']),
    method('logging.googleapis.com','GET','google.logging.v2.ConfigServiceV2.ListExclusions',project+'/exclusions',['name','filter','disabled','createTime','updateTime','nextPageToken']),
    method('logging.googleapis.com','GET','google.logging.v2.ConfigServiceV2.ListBuckets',project+'/locations/-/buckets',['name','retentionDays','lifecycleState','createTime','updateTime','nextPageToken']),
    method('logging.googleapis.com','GET','google.logging.v2.ConfigServiceV2.ListViews',project+'/locations/{discoveredLocation}/buckets/{discoveredBucket}/views',['name','filter','createTime','updateTime','nextPageToken'],['same-project bucket found in permitted metadata only']),
    method('logging.googleapis.com','POST','google.iam.v1.IAMPolicy.TestIamPermissions',project+'/locations/{discoveredLocation}/buckets/{discoveredBucket}/views/{discoveredView}:testIamPermissions',['permissions'],['only same-project discovered views; request logging.views.access','diagnostic only: testIamPermissions is not authorization and may fail open; actual scoped entries:list result is also required']),
    method('cloudasset.googleapis.com','GET','google.cloud.asset.v1.AssetService.BatchGetAssetsHistory',project+':batchGetAssetsHistory',['asset.name','asset.iamPolicy.auditConfigs','asset.resource.data.name','asset.resource.data.retentionDays','asset.resource.data.filter','asset.resource.data.destination','asset.resource.data.disabled','asset.resource.data.exclusions','deleted','window','priorAssetState'],['only exact project IAM_POLICY plus exact discovered routing/bucket resource names, bounded per request','readTimeWindow='+start+'..'+end,'history may be unavailable or incomplete; missing asset/history is not no-effect proof','no export job, feed creation, sink change or log enablement']),
  ];
  const permissions=['run.jobs.get','run.executions.list','run.executions.get','run.tasks.list','run.operations.list','run.operations.get','logging.logEntries.list','logging.privateLogEntries.list','logging.sinks.list','logging.exclusions.list','logging.buckets.list','logging.views.list','logging.views.access','resourcemanager.projects.get','resourcemanager.projects.getIamPolicy','resourcemanager.folders.get','resourcemanager.folders.getIamPolicy','resourcemanager.organizations.getIamPolicy','cloudasset.assets.exportIamPolicy','cloudasset.assets.exportResource'];
  const plan={schemaVersion:1,kind:'GENERAL_HISTORICAL_READ_SEARCH_PROPOSAL_V1',status:'PREPARED_NOT_AUTHORIZED_NOT_EXECUTED',incident:structuredClone(incident),
    audit:{serviceName:'run.googleapis.com',methodName:'google.cloud.run.v2.Jobs.RunJob',permissionType:'DATA_WRITE',filter,start,end,currentConfigurationDoesNotProveHistoricalConfiguration:true,enablementExemptionsRoutingRetentionAndEffectiveReadAccessRequired:true,enablementNotToBeChanged:true},
    methods,permissionsToTest:permissions,bounds:{maximumDurationSeconds:900,requestDeadlineSeconds:15,maximumRequests:200,maximumPagesPerCollection:20,pageSize:100,maximumTotalResponseBytes:20971520,maximumAncestryDepth:5},
    stopConditions:['any attempted write or Jobs.RunJob/create/update/delete/cancel/wait','job UID different from the preserved UID','original snapshot or journal hash changes','source/authority mismatch','authentication safety intervention required','permission denied or response malformed: retain gap, no identical retry','pagination cycle, resource outside scope, budget/deadline exceeded','multiple candidates or incomplete coverage: retain ambiguity, no forced attribution'],
    expectedEffects:{nativeBusinessMutation:false,jobRun:false,jobCreation:false,originalJournalWrite:false,iamOrLoggingConfigurationChange:false,localMinimizedEvidenceWrite:true,readAuditEventsMayBeGenerated:true,apiQuotaMayBeConsumed:true},
    conclusions:{historical:'Only independent attribution may establish the old outcome; empty bounded searches do not prove no effect',currentPre:'NOT_ACQUIRED; historical metadata/output never changes original timestamps or 300000ms freshness guard'},
    knownCoverageLimits:['Current inherited auditConfigs/exemptions do not prove inherited policy on 28October; historical ancestor configuration remains UNPROVEN unless separately sourced','in_scope(ALL) does not prove all ancestral routing; unread ancestor routing remains a gap','Cloud Asset IAM_POLICY history may contain gaps; Cloud Logging asset history may be incomplete or delayed','Current IAM permission tests are diagnostic only and do not prove historical access or historical log generation','A bounded empty result, denied view, expired/deleted resource or pagination cap is never proof of no original effect'],
    documentation:[
      'https://docs.cloud.google.com/run/docs/audit-logging',
      'https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions/list',
      'https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.operations/list',
      'https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list',
      'https://docs.cloud.google.com/logging/docs/audit/configure-data-access',
      'https://docs.cloud.google.com/asset-inventory/docs/reference/rest/v1/TopLevel/batchGetAssetsHistory',
      'https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/getIamPolicy',
    ],nativeExecutionAuthorized:false,canRetry:false,activationAuthorized:false};
  return Object.freeze({...plan,planSha256:digest(plan)});
}

export function makeFreshPreContractProposal(incident) {
  assert.deepEqual(incident,GENERAL_INCIDENT,'EXACT_EXISTING_INCIDENT_REQUIRED');
  return Object.freeze({schemaVersion:1,kind:'FRESH_PRE_WITH_PRESERVED_UNKNOWN_CONTRACT_PROPOSAL_V1',status:'PROPOSAL_ONLY_NOT_AUTHORIZED',incident:structuredClone(incident),
    conditionalImpasse:'Historical attribution may remain impossible, while current contract prohibits a new collection and old outputs are stale',
    proposedChange:'Only a separately reviewed and specifically authorized additive read-only observation capability, after explicit effect analysis; never a disguised retry of the consumed RUN',
    requiredAnalysis:['possible duplicate native execution metadata even though SQL collector is read-only','current collector role and every query must be proven SELECT-only','permission-fence/bootstrap startup side effects must be excluded or explicitly accounted for','fresh schema/pool/business observations must be composed honestly across transactions','stable source/job/UID attribution and durable independent receipt without rewriting historical UNKNOWN'],
    preserved:['original RUN INTENT and UNKNOWN','canRetry=false','existing objective and job identities','Ledger FIN no replay','300000ms freshness limit','N0=2586/generation/547dispositions/all2587+','mail/portfolio/business Schedulers and later writes'],
    executionPlanGenerated:false,newObjectiveCreated:false,newJobNameGenerated:false,newRunAuthorized:false,nativeCalls:0,journalWrites:0,nativeAcceptance:false,activationAuthorized:false});
}
