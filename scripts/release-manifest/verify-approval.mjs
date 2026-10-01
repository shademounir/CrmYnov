import { appendFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { DELEGATED_CODEX_MODE, GRANT_PATH, grantDigest } from "../pr-policy/delegation.mjs";
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
const approvalMode = requiredEnv("RELEASE_APPROVAL_MODE");
const evidence = await fetchSoloOwnerApprovalEvidence({
  repositoryName: requiredEnv("GITHUB_REPOSITORY"),
  pullRequestNumber,
  token: requiredEnv("GITHUB_TOKEN"),
  includeDelegation: approvalMode === DELEGATED_CODEX_MODE,
});
const manifest = JSON.parse(
  await readFile(process.env.RELEASE_MANIFEST_PATH || "release-manifest.json", "utf8"),
);
let trustedGrant;
let headGrantDigest;
if (approvalMode === DELEGATED_CODEX_MODE) {
  // Fetch the protected authority, not the release PR's copy of its grant.
  execFileSync("git", ["fetch", "--no-tags", "origin", "develop"]);
  trustedGrant = JSON.parse(execFileSync("git", ["show", `FETCH_HEAD:${GRANT_PATH}`], { encoding: "utf8" }));
  headGrantDigest = grantDigest(JSON.parse(execFileSync("git", ["show", `${evidence.pullRequest.head.sha}:${GRANT_PATH}`], { encoding: "utf8" })));
}
const result = validateReleaseApproval({
  approvalMode,
  pullRequest: evidence.pullRequest,
  repository: evidence.repository,
  allowedActors: requiredEnv("JIRA_SYNC_ALLOWED_ACTORS"),
  manualPoDecision: evidence.manualPoDecision,
  autoMergeEvents: evidence.autoMergeEvents,
  releaseProfile: manifest.profile,
  policyCheckRuns: evidence.policyCheckRuns,
  changedFiles: evidence.changedFiles,
  delegatedDecision: evidence.delegatedDecision,
  trustedGrant,
  headGrantDigest,
});

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `approval_validated=true\nhuman_approved=${result.humanApproved === true}\nrelease_author=${result.author}\n`,
    "utf8",
  );
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
