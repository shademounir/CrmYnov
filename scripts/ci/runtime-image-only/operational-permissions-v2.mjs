// Closed method-to-permission matrix. A permission test is an instantaneous
// observation, not a reservation, source qualification or resource operation.
export const IMAGE_PROJECT_PERMISSIONS_V2=Object.freeze([
  'artifactregistry.repositories.downloadArtifacts',
  'cloudscheduler.jobs.list','cloudsql.backupRuns.create','cloudsql.backupRuns.get','cloudsql.backupRuns.list','cloudsql.instances.get',
  'iam.serviceAccounts.actAs','logging.logEntries.list','run.executions.get','run.executions.list','run.jobs.get','run.jobs.list','run.jobs.run',
  'run.operations.get','run.revisions.get','run.services.get','run.services.update','run.tasks.list'
]);
export const IMAGE_SERVICE_PERMISSIONS_V2=Object.freeze(['run.services.get','run.services.update']);
export const IMAGE_GENERAL_JOB_PERMISSIONS_V2=Object.freeze(['run.executions.list','run.jobs.get','run.jobs.run']);
export const IMAGE_PERMISSION_METHODS_V2=Object.freeze({
  getService:['run.services.get'],getRevision:['run.revisions.get'],listJobs:['run.jobs.list'],getJob:['run.jobs.get'],
  listExecutions:['run.executions.list'],getExecution:['run.executions.get'],listTasks:['run.tasks.list'],getRunOperation:['run.operations.get'],
  listSchedulers:['cloudscheduler.jobs.list'],getSqlInstance:['cloudsql.instances.get'],getSqlOperation:['cloudsql.instances.get'],
  listBackups:['cloudsql.backupRuns.list'],getBackup:['cloudsql.backupRuns.get'],createBackup:['cloudsql.backupRuns.create'],
  patchServiceImage:['run.services.update','iam.serviceAccounts.actAs','artifactregistry.repositories.downloadArtifacts'],generalRun:['run.jobs.run'],generalOutput:['logging.logEntries.list']
});
export const IMAGE_PERMISSION_EVIDENCE_LIMITS_V2=Object.freeze({
  observedScope:'AUTHENTICATED_CALLER_AT_OBSERVATION_TIME_ON_EXPLICIT_RESOURCE',
  projectTestDoesNotProveChildResourceConditions:true,futureExecutionTaskOperationIdsNotYetObservableBeforeRun:true,
  nativeMethodResponsesStillRequired:true,permissionSetIsNotAuthority:true,permissionSetIsNotFutureReservation:true,
  deployerPermissionsAreNotRuntimeServiceAgentImagePullProof:true,actAsNotAssertedForUnchangedGeneralJobRun:true,
  http403DoesNotProveExpiredToken:true,iamMutationAuthorized:false
});
