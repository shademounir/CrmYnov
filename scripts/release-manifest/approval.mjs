const SOLO_OWNER_MODE = "solo-owner";
const PRODUCT_OWNER_LABEL = "po-approved";

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

export function validateSoloOwnerApproval({
  approvalMode,
  pullRequest,
  repository,
  allowedActors,
}) {
  if (approvalMode !== SOLO_OWNER_MODE) refuse("approval_mode_not_supported");

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
  if (!labels.includes(PRODUCT_OWNER_LABEL)) {
    refuse("po_approved_label_missing");
  }

  if (pullRequest.auto_merge !== null) refuse("auto_merge_was_configured");
  if (repository.allow_auto_merge !== false) {
    refuse("repository_auto_merge_not_disabled");
  }

  return {
    approvalMode: SOLO_OWNER_MODE,
    productOwnerLabel: PRODUCT_OWNER_LABEL,
    author,
    mergedBy,
    manuallyMerged: true,
    humanApproved: true,
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

  return {
    pullRequest: await pullRequestResponse.json(),
    repository: await repositoryResponse.json(),
  };
}

export { PRODUCT_OWNER_LABEL, SOLO_OWNER_MODE };
