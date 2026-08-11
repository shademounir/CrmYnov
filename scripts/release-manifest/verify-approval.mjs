import { appendFile, readFile } from "node:fs/promises";
import {
  fetchSoloOwnerApprovalEvidence,
  validateReleaseApproval,
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
const manifest = JSON.parse(
  await readFile(process.env.RELEASE_MANIFEST_PATH || "release-manifest.json", "utf8"),
);
const result = validateReleaseApproval({
  approvalMode: requiredEnv("RELEASE_APPROVAL_MODE"),
  pullRequest: evidence.pullRequest,
  repository: evidence.repository,
  allowedActors: requiredEnv("JIRA_SYNC_ALLOWED_ACTORS"),
  manualPoDecision: evidence.manualPoDecision,
  autoMergeEvents: evidence.autoMergeEvents,
  releaseProfile: manifest.profile,
  policyCheckRuns: evidence.policyCheckRuns,
});

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `approval_validated=true\nhuman_approved=${result.humanApproved === true}\nrelease_author=${result.author}\n`,
    "utf8",
  );
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
