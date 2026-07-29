import {
  fetchAllCheckRuns,
  parseRequiredChecks,
  validateRequiredChecks,
} from "./checks.mjs";

const requiredChecks = parseRequiredChecks(process.env.REQUIRED_RELEASE_CHECKS);
const checkRuns = await fetchAllCheckRuns({
  repository: process.env.GITHUB_REPOSITORY,
  commitSha: process.env.RELEASE_COMMIT,
  token: process.env.GITHUB_TOKEN,
});
const result = validateRequiredChecks(requiredChecks, checkRuns);
process.stdout.write(`${JSON.stringify(result)}\n`);
