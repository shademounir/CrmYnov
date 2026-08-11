import {
  fetchAllCheckRuns,
  releaseProfile,
  validateManifest,
  validateRequiredChecks,
} from "./index.mjs";
import { readFile } from "node:fs/promises";

const manifest = validateManifest(
  JSON.parse(
    await readFile(process.env.RELEASE_MANIFEST_PATH || "release-manifest.json", "utf8"),
  ),
);
const requiredChecks = releaseProfile(manifest.profile).requiredChecks;
const checkRuns = await fetchAllCheckRuns({
  repository: process.env.GITHUB_REPOSITORY,
  commitSha: process.env.RELEASE_COMMIT,
  token: process.env.GITHUB_TOKEN,
});
const result = validateRequiredChecks(requiredChecks, checkRuns, {
  expectedSha: process.env.RELEASE_COMMIT,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
