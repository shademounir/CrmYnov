# Rollback compatible

Pause only the dedicated business-mail Scheduler/job and persist enabled=false
under the permission write fence. Preserve activated_at, all memberships, settings,
audits and every delivery record including SENDING/UNCERTAIN. Keep the independent
RC36 Scheduler/job enabled and its qualified image unchanged. A protected code revert
may leave these additive empty/new tables in place. Never DROP/TRUNCATE, restore SQL,
remove journal triggers, reset activation or replay any invitation/business event.
