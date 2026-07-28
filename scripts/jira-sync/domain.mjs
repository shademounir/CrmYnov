import { createHash } from "node:crypto";

export const STATUS = Object.freeze({
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  DONE: "Done",
});

export const TRANSITION = Object.freeze({
  START: Object.freeze({
    id: "2",
    name: "Démarrer le travail",
    from: STATUS.TODO,
    to: STATUS.IN_PROGRESS,
  }),
  SUBMIT_REVIEW: Object.freeze({
    id: "3",
    name: "Soumettre en revue",
    from: STATUS.IN_PROGRESS,
    to: STATUS.IN_REVIEW,
  }),
  RESUME: Object.freeze({
    id: "4",
    name: "Reprendre le travail",
    from: STATUS.IN_REVIEW,
    to: STATUS.IN_PROGRESS,
  }),
  COMPLETE: Object.freeze({
    id: "5",
    name: "Clôturer après release",
    from: STATUS.IN_REVIEW,
    to: STATUS.DONE,
  }),
});

export const INTENT = Object.freeze({
  WORK_BRANCH_CREATED: "work_branch_created",
  PR_DRAFT: "pr_draft",
  PR_READY: "pr_ready",
  CHANGES_REQUESTED: "changes_requested",
  MERGED_DEVELOP: "merged_develop",
  PR_CLOSED_UNMERGED: "pr_closed_unmerged",
  RELEASE_PUBLISHED: "release_published",
  IGNORE: "ignore",
});

function branchIssueKey(branch, projectKey) {
  const escapedProject = projectKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(?:feature|fix)/(${escapedProject}-\\d+)(?:-[a-z0-9][a-z0-9-]*)?$`,
    "i",
  );
  return branch?.match(pattern)?.[1]?.toUpperCase() ?? null;
}

function textIssueKey(text, projectKey) {
  const escapedProject = projectKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    String(text ?? "")
      .match(new RegExp(`\\b(${escapedProject}-\\d+)\\b`, "i"))?.[1]
      ?.toUpperCase() ?? null
  );
}

export function extractIssueKey(payload, projectKey) {
  return (
    branchIssueKey(payload?.ref, projectKey) ??
    branchIssueKey(payload?.pull_request?.head?.ref, projectKey) ??
    textIssueKey(payload?.ticketKey, projectKey) ??
    textIssueKey(payload?.pull_request?.title, projectKey) ??
    textIssueKey(payload?.pull_request?.body, projectKey)
  );
}

export function normalizeGithubEvent(eventName, payload, projectKey) {
  const issueKey = extractIssueKey(payload, projectKey);

  if (eventName === "create" && payload?.ref_type === "branch") {
    return { intent: INTENT.WORK_BRANCH_CREATED, issueKey };
  }

  if (eventName === "pull_request") {
    const action = payload?.action;
    if (action === "ready_for_review") {
      return { intent: INTENT.PR_READY, issueKey };
    }
    if (["opened", "reopened", "converted_to_draft"].includes(action)) {
      return {
        intent: payload?.pull_request?.draft ? INTENT.PR_DRAFT : INTENT.PR_READY,
        issueKey,
      };
    }
    if (action === "closed") {
      if (!payload?.pull_request?.merged) {
        return { intent: INTENT.PR_CLOSED_UNMERGED, issueKey };
      }
      if (payload?.pull_request?.base?.ref === "develop") {
        return { intent: INTENT.MERGED_DEVELOP, issueKey };
      }
    }
  }

  if (
    eventName === "pull_request_review" &&
    payload?.action === "submitted" &&
    payload?.review?.state?.toLowerCase() === "changes_requested"
  ) {
    return { intent: INTENT.CHANGES_REQUESTED, issueKey };
  }

  if (
    eventName === "release" &&
    payload?.action === "published" &&
    payload?.release?.draft === false
  ) {
    return { intent: INTENT.RELEASE_PUBLISHED, issueKey };
  }

  return { intent: INTENT.IGNORE, issueKey };
}

function releaseEvidenceIsComplete(evidence) {
  return [
    "humanApproved",
    "ciGreen",
    "mergedToMain",
    "tagCreated",
    "releasePublished",
    "listedInManifest",
  ].every((key) => evidence?.[key] === true);
}

function planned(transition, reason) {
  return {
    decision: "transition",
    reason,
    transition,
    targetStatus: transition.to,
  };
}

function noMutation(reason) {
  return { decision: "no_op", reason, transition: null, targetStatus: null };
}

function denied(reason) {
  return { decision: "denied", reason, transition: null, targetStatus: null };
}

export function evaluateTransition({
  intent,
  issue,
  releaseEvidence,
  projectKey = "CRMY",
}) {
  if (!issue?.key?.startsWith(`${projectKey}-`)) {
    return denied("wrong_project");
  }
  if (!issue.labels?.includes("codex-ready")) {
    return denied("missing_codex_ready");
  }
  if (issue.blocked === true) {
    return denied("issue_blocked");
  }

  const current = issue.status;

  if (intent === INTENT.WORK_BRANCH_CREATED) {
    if (current === STATUS.TODO) {
      return planned(TRANSITION.START, "work_started");
    }
    if (current === STATUS.IN_PROGRESS) {
      return noMutation("already_in_progress");
    }
    return denied("invalid_status_for_work_start");
  }

  if (intent === INTENT.PR_DRAFT) {
    if (current === STATUS.TODO) {
      return planned(TRANSITION.START, "draft_pull_request_started_work");
    }
    if (current === STATUS.IN_PROGRESS) {
      return noMutation("draft_pull_request_remains_in_progress");
    }
    if (current === STATUS.IN_REVIEW) {
      return planned(TRANSITION.RESUME, "pull_request_returned_to_draft");
    }
    return denied("invalid_status_for_draft_pull_request");
  }

  if (intent === INTENT.PR_READY) {
    if (current === STATUS.IN_PROGRESS) {
      return planned(TRANSITION.SUBMIT_REVIEW, "pull_request_ready");
    }
    if (current === STATUS.IN_REVIEW) {
      return noMutation("already_in_review");
    }
    return denied("review_cannot_skip_work_start");
  }

  if (intent === INTENT.CHANGES_REQUESTED) {
    if (current === STATUS.IN_REVIEW) {
      return planned(TRANSITION.RESUME, "changes_requested");
    }
    if (current === STATUS.IN_PROGRESS) {
      return noMutation("already_back_in_progress");
    }
    return denied("invalid_status_for_changes_requested");
  }

  if (intent === INTENT.MERGED_DEVELOP) {
    return current === STATUS.IN_REVIEW
      ? noMutation("awaiting_validated_release")
      : denied("merge_develop_requires_in_review");
  }

  if (intent === INTENT.PR_CLOSED_UNMERGED) {
    return noMutation("pull_request_closed_without_merge");
  }

  if (intent === INTENT.RELEASE_PUBLISHED) {
    if (issue.issueType === "Epic") {
      return denied("epic_done_forbidden");
    }
    if (!releaseEvidenceIsComplete(releaseEvidence)) {
      return denied("release_evidence_incomplete");
    }
    if (current !== STATUS.IN_REVIEW) {
      return denied("release_completion_requires_in_review");
    }
    return planned(TRANSITION.COMPLETE, "validated_release_published");
  }

  return noMutation("event_not_actionable");
}

export function isExternalPullRequest(payload, repository) {
  const headRepository = payload?.pull_request?.head?.repo?.full_name;
  return Boolean(headRepository && repository && headRepository !== repository);
}

export function actorIsAllowed(actor, allowedActors) {
  return Boolean(actor && allowedActors.includes(actor));
}

export function idempotencyKey({ deliveryId, intent, issueKey, transitionId }) {
  return createHash("sha256")
    .update(
      [deliveryId || "no-delivery", intent, issueKey, transitionId || "none"].join(
        ":",
      ),
    )
    .digest("hex");
}
