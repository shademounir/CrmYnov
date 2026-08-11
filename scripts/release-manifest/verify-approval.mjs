import { appendFile } from "node:fs/promises";
import {
  fetchSoloOwnerApprovalEvidence,
  validateSoloOwnerApproval,
} from "./approval.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const pullRequestNumber = Number(requiredEnv("RELEASE_PR_NUMBER"));
const evidence = await fetchSoloOwnerApprovalEvidence({
  repositoryName: requiredEnv("GITHUB_REPOSITORY"),
  pullRequestNumber,
  token: requiredEnv("GITHUB_TOKEN"),
});
const result = validateSoloOwnerApproval({
  approvalMode: requiredEnv("RELEASE_APPROVAL_MODE"),
  pullRequest: evidence.pullRequest,
  repository: evidence.repository,
  allowedActors: requiredEnv("JIRA_SYNC_ALLOWED_ACTORS"),
  releaseCommit: requiredEnv("RELEASE_COMMIT"),
  releasePublishedAt: requiredEnv("RELEASE_PUBLISHED_AT"),
  repositoryAutoMergeAttestation: {
    state: process.env.REPOSITORY_AUTO_MERGE_ATTESTED_STATE,
    actor: process.env.REPOSITORY_AUTO_MERGE_ATTESTED_BY,
    sha: process.env.REPOSITORY_AUTO_MERGE_ATTESTED_SHA,
    at: process.env.REPOSITORY_AUTO_MERGE_ATTESTED_AT,
  },
});

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `human_approved=true\nrelease_author=${result.author}\n`,
    "utf8",
  );
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
