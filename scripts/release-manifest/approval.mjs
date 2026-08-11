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

const MAX_ATTESTATION_AGE_MS = 24 * 60 * 60 * 1000;
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

function validateRepositoryAutoMerge({
  repository,
  allowedActors,
  releaseCommit,
  releasePublishedAt,
  attestation,
}) {
  if (repository.allow_auto_merge === true) {
    refuse("repository_auto_merge_enabled");
  }
  if (repository.allow_auto_merge === false) {
    return { source: "github_api", state: "disabled" };
  }

  const proof = {
    state: String(attestation?.state ?? "").trim(),
    actor: String(attestation?.actor ?? "").trim(),
    sha: String(attestation?.sha ?? "").trim(),
    at: String(attestation?.at ?? "").trim(),
  };
  const populated = Object.values(proof).filter(Boolean).length;
  if (populated === 0) refuse("repository_auto_merge_state_unavailable");
  if (populated !== 4) refuse("repository_auto_merge_attestation_incomplete");
  if (proof.state !== "disabled") {
    refuse("repository_auto_merge_state_unavailable");
  }
  if (!allowedActors.includes(proof.actor)) {
    refuse("repository_auto_merge_attestation_actor_not_allowed");
  }
  if (
    !COMMIT_SHA_PATTERN.test(String(releaseCommit ?? "")) ||
    !COMMIT_SHA_PATTERN.test(proof.sha) ||
    proof.sha.toLowerCase() !== releaseCommit.toLowerCase()
  ) {
    refuse("repository_auto_merge_attestation_sha_mismatch");
  }

  const attestedAt = timestamp(proof.at);
  const publishedAt = timestamp(releasePublishedAt);
  if (
    attestedAt === undefined ||
    publishedAt === undefined ||
    attestedAt > publishedAt
  ) {
    refuse("repository_auto_merge_attestation_invalid_date");
  }
  if (publishedAt - attestedAt >= MAX_ATTESTATION_AGE_MS) {
    refuse("repository_auto_merge_attestation_expired");
  }

  return {
    source: "po_attestation",
    state: "disabled",
    actor: proof.actor,
    sha: proof.sha,
    at: proof.at,
  };
}

export function validateSoloOwnerApproval({
  approvalMode,
  pullRequest,
  repository,
  allowedActors,
  releaseCommit,
  releasePublishedAt,
  repositoryAutoMergeAttestation,
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
  const repositoryAutoMerge = validateRepositoryAutoMerge({
    repository,
    allowedActors: actors,
    releaseCommit,
    releasePublishedAt,
    attestation: repositoryAutoMergeAttestation,
  });

  return {
    approvalMode: SOLO_OWNER_MODE,
    productOwnerLabel: PRODUCT_OWNER_LABEL,
    author,
    mergedBy,
    manuallyMerged: true,
    humanApproved: true,
    repositoryAutoMerge,
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
