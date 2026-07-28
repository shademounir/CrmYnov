import {
  actorIsAllowed,
  evaluateTransition,
  idempotencyKey,
  INTENT,
  isExternalPullRequest,
  normalizeGithubEvent,
} from "./domain.mjs";
import { hasReadCredentials, safeConfigSummary } from "./config.mjs";
import { JiraClient } from "./jira-client.mjs";

export async function runSync({
  eventName,
  payload,
  config,
  repository,
  actor,
  deliveryId,
  fetchImpl,
  issueOverride,
  idempotencyStore = new Set(),
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

  const client = new JiraClient(config, fetchImpl);
  if (!issueOverride && !hasReadCredentials(config)) {
    return {
      ...baseResult,
      decision: "no_op",
      reason: "jira_read_credentials_missing",
    };
  }

  const issue = issueOverride ?? (await client.getIssue(event.issueKey));
  const evaluation = evaluateTransition({
    intent: event.intent,
    issue,
    releaseEvidence: payload?.releaseEvidence,
    projectKey: config.projectKey,
  });

  if (evaluation.decision !== "transition") {
    return {
      ...baseResult,
      decision: evaluation.decision,
      reason: evaluation.reason,
    };
  }

  const key = idempotencyKey({
    deliveryId,
    intent: event.intent,
    issueKey: event.issueKey,
    transitionId: evaluation.transition.id,
  });
  if (idempotencyStore.has(key)) {
    return {
      ...baseResult,
      decision: "no_op",
      reason: "duplicate_event",
      idempotencyKey: key,
    };
  }
  idempotencyStore.add(key);

  const transitionResult = await client.transition(
    event.issueKey,
    evaluation.transition,
    key,
  );
  return {
    ...baseResult,
    decision: "transition",
    reason: evaluation.reason,
    transition: {
      id: evaluation.transition.id,
      name: evaluation.transition.name,
      from: evaluation.transition.from,
      to: evaluation.transition.to,
    },
    ...transitionResult,
  };
}
