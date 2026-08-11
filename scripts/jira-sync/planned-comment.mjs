const SAFE_EVENT_NAMES = new Set([
  "work_branch_created",
  "pr_draft",
  "pr_ready",
  "changes_requested",
  "merged_develop",
  "pr_closed_unmerged",
  "release_published",
]);
const SAFE_CI_RESULTS = new Set([
  "success",
  "failure",
  "pending",
  "cancelled",
  "unknown",
]);
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function validString(value, pattern) {
  const normalized = String(value ?? "").trim();
  return pattern.test(normalized) ? normalized : null;
}

function eventDate(payload, now) {
  const candidates = [
    payload?.review?.submitted_at,
    payload?.pull_request?.merged_at,
    payload?.pull_request?.closed_at,
    payload?.pull_request?.updated_at,
    payload?.pull_request?.created_at,
    payload?.release?.published_at,
    payload?.release?.created_at,
  ];
  const source = candidates.find(Boolean) ?? now().toISOString();
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? now().toISOString() : date.toISOString();
}

function githubMetadata(payload, repository) {
  const pullRequestNumber = Number(payload?.pull_request?.number ?? payload?.number);
  const safePullRequestNumber =
    Number.isSafeInteger(pullRequestNumber) && pullRequestNumber > 0
      ? pullRequestNumber
      : null;
  const safeRepository = validString(repository, REPOSITORY_PATTERN);
  const branch = validString(
    payload?.pull_request?.head?.ref ??
      payload?.ref ??
      payload?.release?.target_commitish,
    BRANCH_PATTERN,
  );
  const sha = validString(
    payload?.pull_request?.head?.sha ??
      payload?.review?.commit_id ??
      payload?.after ??
      payload?.releaseCommit,
    SHA_PATTERN,
  );
  const releaseVersion = validString(
    payload?.release?.tag_name,
    VERSION_PATTERN,
  );
  const suppliedCiResult = String(payload?.ciResult ?? "").toLowerCase();
  const ciResult = SAFE_CI_RESULTS.has(suppliedCiResult)
    ? suppliedCiResult
    : payload?.releaseEvidence?.ciGreen === true
      ? "success"
      : null;

  return {
    branch,
    pullRequestNumber: safePullRequestNumber,
    pullRequestUrl:
      safeRepository && safePullRequestNumber
        ? `https://github.com/${safeRepository}/pull/${safePullRequestNumber}`
        : null,
    sha,
    ciResult,
    releaseVersion,
  };
}

export function buildPlannedComment({
  issueKey,
  intent,
  payload,
  repository,
  githubActionsRunId,
  now = () => new Date(),
}) {
  if (!/^CRMY-\d+$/.test(issueKey) || !SAFE_EVENT_NAMES.has(intent)) {
    return null;
  }

  const runId = String(githubActionsRunId ?? "").trim();
  const metadata = githubMetadata(payload, repository);
  const comment = {
    jiraKey: issueKey,
    event: intent,
    ...metadata,
    githubActionsRunId: /^\d+$/.test(runId) ? runId : null,
    dateUtc: eventDate(payload, now),
  };

  return Object.fromEntries(
    Object.entries(comment).filter(([, value]) => value !== null),
  );
}

export function plannedCommentToAdf(plannedComment) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "codeBlock",
        attrs: { language: "json" },
        content: [
          {
            type: "text",
            text: JSON.stringify(plannedComment, null, 2),
          },
        ],
      },
    ],
  };
}
