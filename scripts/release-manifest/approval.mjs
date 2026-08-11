const MANUAL_PO_MODE = "manual-po";
const AUTOMATED_POLICY_MODE = "automated-policy";
const PRODUCT_OWNER_LABEL = "po-approved";
const POLICY_APPROVED_LABEL = "policy-approved";

function normalizedActors(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [
    ...new Set(
      values
        .map((actor) => String(actor).trim())
        .filter(Boolean),
    ),
  ];
}

function refuse(reason) {
  const error = new Error(`Release Product Owner approval refused: ${reason}.`);
  error.reason = reason;
  throw error;
}

const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function timestamp(value) {
  const input = String(value ?? "");
  if (!UTC_TIMESTAMP_PATTERN.test(input)) return undefined;
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) return undefined;
  const canonicalInput = input.includes(".")
    ? input.replace(/\.(\d{1,3})Z$/, (_, digits) =>
        `.${digits.padEnd(3, "0")}Z`,
      )
    : input.replace(/Z$/, ".000Z");
  return new Date(parsed).toISOString() === canonicalInput ? parsed : undefined;
}

function validateManualPoDecision({ decision, pullRequest, allowedActors }) {
  if (!decision) refuse("manual_po_decision_missing");
  if (decision.decision !== "approved") refuse("manual_po_decision_not_approved");
  if (decision.pullRequest !== pullRequest.number) {
    refuse("manual_po_decision_pr_mismatch");
  }
  if (
    !COMMIT_SHA_PATTERN.test(decision.headSha ?? "") ||
    decision.headSha.toLowerCase() !== String(pullRequest.head?.sha ?? "").toLowerCase()
  ) {
    refuse("manual_po_decision_sha_mismatch");
  }
  if (!allowedActors.includes(decision.actor)) {
    refuse("manual_po_decision_actor_not_allowed");
  }
  if (!Number.isSafeInteger(decision.commentId) || decision.commentId <= 0) {
    refuse("manual_po_decision_not_traceable");
  }
  const decidedAt = timestamp(decision.createdAt);
  const mergedAt = timestamp(pullRequest.merged_at);
  if (decidedAt === undefined || mergedAt === undefined || decidedAt > mergedAt) {
    refuse("manual_po_decision_invalid_date");
  }
  return {
    source: "github_issue_comment",
    actor: decision.actor,
    commentId: decision.commentId,
    createdAt: decision.createdAt,
    pullRequest: decision.pullRequest,
    headSha: decision.headSha,
  };
}

export function validateReleaseApproval({
  approvalMode,
  pullRequest,
  repository,
  allowedActors,
  manualPoDecision,
  autoMergeEvents = [],
  releaseProfile,
  policyCheckRuns = [],
}) {
  if (![MANUAL_PO_MODE, AUTOMATED_POLICY_MODE].includes(approvalMode)) {
    refuse("approval_mode_not_supported");
  }

  const actors = normalizedActors(allowedActors);
  if (actors.length === 0) refuse("allowed_actor_list_empty");
  if (!pullRequest || !repository) refuse("github_evidence_missing");
  if (pullRequest.draft !== false) refuse("release_pr_is_draft");
  if (pullRequest.base?.ref !== "main") refuse("release_pr_base_not_main");
  if (pullRequest.merged !== true || !pullRequest.merged_at) {
    refuse("release_pr_not_merged");
  }

  const author = pullRequest.user?.login;
  const mergedBy = pullRequest.merged_by?.login;
  if (!actors.includes(author)) refuse("release_pr_author_not_allowed");
  if (!actors.includes(mergedBy)) refuse("release_pr_merger_not_allowed");

  const labels = Array.isArray(pullRequest.labels)
    ? pullRequest.labels.map((label) => label?.name)
    : [];
  if (approvalMode === AUTOMATED_POLICY_MODE) {
    if (labels.includes(PRODUCT_OWNER_LABEL)) {
      refuse("po_approved_forbidden_in_automated_policy");
    }
    if (!labels.includes(POLICY_APPROVED_LABEL)) {
      refuse("policy_approved_label_missing");
    }
    if (!/^release\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pullRequest.head?.ref ?? "")) {
      refuse("release_branch_not_allowed");
    }
    if (releaseProfile !== "gate-1") refuse("automated_policy_prod_forbidden");
    const policyRuns = policyCheckRuns
      .filter((run) => run.name === "pr-policy")
      .sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0));
    const policyRun = policyRuns[0];
    if (!policyRun) refuse("pr_policy_check_missing");
    if (policyRun.status !== "completed") refuse("pr_policy_check_pending");
    if (
      policyRun.conclusion !== "success" ||
      policyRun.head_sha !== pullRequest.head?.sha
    ) {
      refuse("pr_policy_check_failed");
    }
    return {
      approvalMode: AUTOMATED_POLICY_MODE,
      policyLabel: POLICY_APPROVED_LABEL,
      author,
      mergedBy,
      mergeMethod:
        pullRequest.auto_merge === null ? "codex_controlled" : "native_auto_merge",
      approvalValidated: true,
    };
  }

  if (!labels.includes(PRODUCT_OWNER_LABEL)) refuse("po_approved_label_missing");
  if (labels.includes(POLICY_APPROVED_LABEL)) {
    refuse("policy_approved_forbidden_in_manual_po");
  }
  if (pullRequest.auto_merge !== null) refuse("auto_merge_was_configured");
  if (autoMergeEvents.length > 0) refuse("auto_merge_event_detected");
  const productOwnerDecision = validateManualPoDecision({
    decision: manualPoDecision,
    pullRequest,
    allowedActors: actors,
  });

  return {
    approvalMode: MANUAL_PO_MODE,
    productOwnerLabel: PRODUCT_OWNER_LABEL,
    author,
    mergedBy,
    manuallyMerged: true,
    humanApproved: true,
    approvalValidated: true,
    productOwnerDecision,
  };
}

export function validateSoloOwnerApproval(input) {
  if (input.approvalMode !== MANUAL_PO_MODE) refuse("approval_mode_not_supported");
  return validateReleaseApproval(input);
}

export function parseManualPoDecision(body) {
  const match = /<!-- manual-po-decision\s*([\s\S]*?)\s*-->/.exec(String(body ?? ""));
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]);
    return value?.schemaVersion === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function selectManualPoDecision(comments, { pullRequestNumber, headSha }) {
  const markers = (comments ?? [])
    .map((comment) => ({ comment, decision: parseManualPoDecision(comment.body) }))
    .filter(({ decision }) => decision)
    .sort((left, right) => Number(right.comment.id) - Number(left.comment.id));
  if (markers.length === 0) return undefined;
  const { comment, decision } = markers[0];
  return {
    decision: decision.decision,
    pullRequest: decision.pullRequest,
    headSha: decision.headSha,
    actor: comment.user?.login,
    commentId: Number(comment.id),
    createdAt: comment.created_at,
    expectedPullRequest: pullRequestNumber,
    expectedHeadSha: headSha,
  };
}

export async function fetchSoloOwnerApprovalEvidence({
  repositoryName,
  pullRequestNumber,
  token,
  fetchImpl = globalThis.fetch,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryName)) {
    throw new Error("Invalid GitHub repository.");
  }
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error("Invalid release pull request number.");
  }
  if (!token) throw new Error("GitHub token is required.");

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const [pullRequestResponse, repositoryResponse] = await Promise.all([
    fetchImpl(
      `https://api.github.com/repos/${repositoryName}/pulls/${pullRequestNumber}`,
      { headers },
    ),
    fetchImpl(`https://api.github.com/repos/${repositoryName}`, { headers }),
  ]);

  if (!pullRequestResponse.ok) {
    throw new Error(
      `GitHub release PR request failed (${pullRequestResponse.status}).`,
    );
  }
  if (!repositoryResponse.ok) {
    throw new Error(
      `GitHub repository request failed (${repositoryResponse.status}).`,
    );
  }

  const pullRequest = await pullRequestResponse.json();
  async function pages(path, label) {
    const values = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
        { headers },
      );
      if (!response.ok) throw new Error(`GitHub ${label} request failed (${response.status}).`);
      const result = await response.json();
      if (!Array.isArray(result)) throw new Error(`Invalid GitHub ${label} evidence.`);
      values.push(...result);
      if (result.length < 100) return values;
    }
    throw new Error(`GitHub ${label} pagination limit exceeded.`);
  }
  const [policyCheckResponse, comments, timeline] = await Promise.all([
    fetchImpl(
      `https://api.github.com/repos/${repositoryName}/commits/${pullRequest.head?.sha}/check-runs?per_page=100`,
      { headers },
    ),
    pages(`/repos/${repositoryName}/issues/${pullRequestNumber}/comments`, "comments"),
    pages(`/repos/${repositoryName}/issues/${pullRequestNumber}/timeline`, "timeline"),
  ]);
  if (!policyCheckResponse.ok) {
    throw new Error(`GitHub policy check request failed (${policyCheckResponse.status}).`);
  }
  const policyChecks = await policyCheckResponse.json();
  return {
    pullRequest,
    repository: await repositoryResponse.json(),
    policyCheckRuns: Array.isArray(policyChecks.check_runs)
      ? policyChecks.check_runs
      : [],
    manualPoDecision: selectManualPoDecision(comments, {
      pullRequestNumber,
      headSha: pullRequest.head?.sha,
    }),
    autoMergeEvents: timeline
      .filter((event) => ["auto_merge_enabled", "auto_merge_disabled"].includes(event.event))
      .map((event) => ({ event: event.event, id: event.id, createdAt: event.created_at })),
  };
}

export {
  AUTOMATED_POLICY_MODE,
  POLICY_APPROVED_LABEL,
  PRODUCT_OWNER_LABEL,
  MANUAL_PO_MODE,
};
