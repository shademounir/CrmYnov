import { readFile } from "node:fs/promises";
import {
  selectAuditComment,
  selectManualPoDecision,
  validatePullRequestPolicy,
} from "./policy.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const repository = required("GITHUB_REPOSITORY");
const token = required("GITHUB_TOKEN");
const pullNumber = Number(required("PR_NUMBER"));
const api = "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function github(path) {
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub evidence request failed (${response.status}).`);
  return response.json();
}

async function pages(path) {
  const values = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await github(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(result)) throw new Error("Invalid paginated GitHub evidence.");
    values.push(...result);
    if (result.length < 100) return values;
  }
  throw new Error("GitHub evidence pagination limit exceeded.");
}

async function checkRuns() {
  const requiredChecks = pull.base.ref === "develop"
    ? ["simulate", "terraform-static", "iac-security"]
    : ["unit-tests", "terraform-static", "iac-security", "secret-scan"];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await github(
      `/repos/${repository}/commits/${checkSha}/check-runs?per_page=100`,
    );
    const runs = response.check_runs ?? [];
    const byName = new Map();
    for (const run of runs) {
      if (
        !byName.has(run.name) ||
        Number(run.id ?? 0) >= Number(byName.get(run.name)?.id ?? 0)
      ) {
        byName.set(run.name, run);
      }
    }
    if (requiredChecks.every((name) => byName.get(name)?.status === "completed")) {
      return { requiredChecks, runs };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Required check wait timeout.");
}

if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
  throw new Error("Invalid PR_NUMBER.");
}

const pull = await github(`/repos/${repository}/pulls/${pullNumber}`);
const checkSha = pull.head?.sha;
if (!/^[0-9a-f]{40}$/i.test(checkSha ?? "")) {
  throw new Error("Invalid pull request head SHA.");
}
const [files, comments, comparison, checks] = await Promise.all([
  pages(`/repos/${repository}/pulls/${pullNumber}/files`),
  pages(`/repos/${repository}/issues/${pullNumber}/comments`),
  github(`/repos/${repository}/compare/${pull.base.sha}...${pull.head.sha}`),
  checkRuns(),
]);
const audit = selectAuditComment(comments, {
  headSha: pull.head.sha,
  allowedActors: required("PR_POLICY_ALLOWED_ACTORS"),
});

const [timeline, threadResponse] = await Promise.all([
  pages(`/repos/${repository}/issues/${pullNumber}/timeline`),
  (async () => {
    const [owner, name] = repository.split("/");
    const response = await fetch(`${api}/graphql`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}}}}`,
        variables: { owner, name, number: pullNumber },
      }),
    });
    if (!response.ok) throw new Error(`GitHub conversation request failed (${response.status}).`);
    return response.json();
  })(),
]);
if (threadResponse.errors) throw new Error("GitHub conversation evidence invalid.");
const threads = threadResponse.data?.repository?.pullRequest?.reviewThreads?.nodes;
if (!Array.isArray(threads)) throw new Error("GitHub conversation evidence missing.");
if (threadResponse.data.repository.pullRequest.reviewThreads.pageInfo?.hasNextPage) {
  throw new Error("GitHub conversation evidence pagination incomplete.");
}

let manualPoDecision;
try {
  manualPoDecision = selectManualPoDecision(comments, {
    pullRequestNumber: pullNumber,
    headSha: pull.head.sha,
    allowedActors: required("PR_POLICY_ALLOWED_ACTORS"),
  });
} catch (error) {
  if (error.reason !== "manual_po_decision_missing") throw error;
}

let manifestProfile;
if (pull.head.ref.startsWith("release/")) {
  const manifest = JSON.parse(await readFile("release-manifest.json", "utf8"));
  manifestProfile = manifest.profile;
}

const result = validatePullRequestPolicy({
  approvalMode: required("PR_APPROVAL_MODE"),
  repository,
  sourceRepository: pull.head.repo?.full_name,
  actor: process.env.GITHUB_ACTOR,
  allowedActors: required("PR_POLICY_ALLOWED_ACTORS"),
  branch: pull.head.ref,
  base: pull.base.ref,
  draft: pull.draft,
  labels: pull.labels,
  ticket: audit.ticket,
  changedFiles: files.map((file) => file.filename),
  manifestProfile,
  mergeable: pull.mergeable,
  branchUpToDate:
    comparison.merge_base_commit?.sha === pull.base.sha &&
    ["ahead", "identical"].includes(comparison.status),
  requiredChecks: checks.requiredChecks,
  checkRuns: checks.runs,
  checkSha,
  pullRequestNumber: pullNumber,
  pullRequestBody: pull.body,
  manualPoDecision,
  autoMerge: pull.auto_merge,
  autoMergeEvents: timeline.filter((event) => ["auto_merge_enabled", "auto_merge_disabled"].includes(event.event)),
  conversationsResolved: threads.every((thread) => thread.isResolved === true),
  poLabelEvents: timeline
    .filter((event) => event.event === "labeled" && event.label?.name === "po-approved")
    .map((event) => ({ actor: event.actor?.login, actorType: event.actor?.type, id: event.id })),
  automationRequested: timeline.some((event) =>
    ["auto_merge_enabled", "merged"].includes(event.event) && event.actor?.type === "Bot",
  ),
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
