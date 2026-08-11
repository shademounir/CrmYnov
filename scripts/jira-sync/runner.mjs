import {
  actorHasWritePermission,
  actorIsAllowed,
  evaluateTransition,
  idempotencyKey,
  INTENT,
  isExternalPullRequest,
  normalizeGithubEvent,
} from "./domain.mjs";
import { hasReadCredentials, safeConfigSummary } from "./config.mjs";
import { JiraClient } from "./jira-client.mjs";
import { buildPlannedComment } from "./planned-comment.mjs";

export async function runSync({
  eventName,
  payload,
  config,
  repository,
  actor,
  actorPermission,
  githubActionsRunId,
  fetchImpl,
  issueOverride,
  persistenceOverride,
  now,
}) {
  const event = normalizeGithubEvent(eventName, payload, config.projectKey);
  const baseResult = {
    event: event.intent,
    issueKey: event.issueKey,
    config: safeConfigSummary(config),
    mutated: false,
  };

  if (event.intent === INTENT.IGNORE) {
    return { ...baseResult, decision: "no_op", reason: "event_not_actionable" };
  }
  if (!event.issueKey) {
    return { ...baseResult, decision: "denied", reason: "missing_issue_key" };
  }
  if (isExternalPullRequest(payload, repository)) {
    return { ...baseResult, decision: "denied", reason: "external_pull_request" };
  }
  if (!actorIsAllowed(actor, config.allowedActors)) {
    return { ...baseResult, decision: "denied", reason: "actor_not_allowed" };
  }
  if (!actorHasWritePermission(actorPermission)) {
    return {
      ...baseResult,
      decision: "denied",
      reason: "actor_write_permission_required",
    };
  }

  const plannedComment = buildPlannedComment({
    issueKey: event.issueKey,
    intent: event.intent,
    payload,
    repository,
    githubActionsRunId,
    now,
  });

  const client = new JiraClient(config, fetchImpl);
  if (!issueOverride && !hasReadCredentials(config)) {
    return {
      ...baseResult,
      decision: "no_op",
      reason: "jira_read_credentials_missing",
      plannedComment,
    };
  }

  const issue = issueOverride ?? (await client.getIssue(event.issueKey));
  const eventKey = idempotencyKey({
    repository,
    intent: event.intent,
    issueKey: event.issueKey,
    payload,
  });
  const persistence = persistenceOverride ?? client;
  const existingRecord = await persistence.getEventRecord(
    event.issueKey,
    eventKey,
  );
  if (existingRecord) {
    return {
      ...baseResult,
      decision: "no_op",
      reason: "duplicate_event",
      idempotencyKey: eventKey,
      plannedComment,
    };
  }

  const evaluation = evaluateTransition({
    intent: event.intent,
    issue,
    releaseEvidence: payload?.releaseEvidence,
    projectKey: config.projectKey,
  });

  if (evaluation.decision === "denied") {
    return {
      ...baseResult,
      decision: evaluation.decision,
      reason: evaluation.reason,
      idempotencyKey: eventKey,
      plannedComment,
    };
  }

  const dateUtc = plannedComment?.dateUtc ?? new Date().toISOString();
  const claimResult = await persistence.recordEvent(
    event.issueKey,
    eventKey,
    "processing",
    dateUtc,
  );
  const transitionResult =
    evaluation.decision === "transition"
      ? await client.transition(
          event.issueKey,
          evaluation.transition,
          eventKey,
        )
      : { mutated: false, mode: "validated-no-op" };
  const commentResult = await client.addComment(event.issueKey, plannedComment);
  const completionResult = await persistence.recordEvent(
    event.issueKey,
    eventKey,
    "completed",
    dateUtc,
  );
  const mutated = [
    claimResult,
    transitionResult,
    commentResult,
    completionResult,
  ].some((result) => result.mutated === true);

  return {
    ...baseResult,
    decision: evaluation.decision,
    reason: evaluation.reason,
    transition: evaluation.transition
      ? {
          id: evaluation.transition.id,
          name: evaluation.transition.name,
          from: evaluation.transition.from,
          to: evaluation.transition.to,
        }
      : null,
    idempotencyKey: eventKey,
    plannedComment,
    persistence: {
      existing: false,
      claimMutated: claimResult.mutated,
      completionMutated: completionResult.mutated,
    },
    commentMutated: commentResult.mutated,
    transitionMutated: transitionResult.mutated,
    mutated,
  };
}
