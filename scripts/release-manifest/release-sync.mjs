import { readFile } from "node:fs/promises";
import { loadConfig } from "../jira-sync/config.mjs";
import { runSync } from "../jira-sync/runner.mjs";
import {
  releaseEvidence,
  validateManifest,
} from "./index.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const manifestPath = process.argv[2] || "release-manifest.json";
const manifest = validateManifest(
  JSON.parse(await readFile(manifestPath, "utf8")),
);
const config = loadConfig();
const releaseTag = requiredEnv("RELEASE_TAG");
const repository = requiredEnv("GITHUB_REPOSITORY");
const actor = requiredEnv("GITHUB_ACTOR");
const idempotencyStore = new Set();
const results = [];

for (const issueKey of manifest.tickets) {
  const evidence = releaseEvidence({
    manifest,
    issueKey,
    releaseTag,
    sourceIncludedInReleasePr:
      process.env.RELEASE_SOURCE_INCLUDED === "true",
    humanApproved: process.env.RELEASE_HUMAN_APPROVED === "true",
    ciGreen: process.env.RELEASE_CI_GREEN === "true",
    mergedToMain: process.env.RELEASE_MERGED_TO_MAIN === "true",
    releasePublished: process.env.RELEASE_PUBLISHED === "true",
  });
  results.push(
    await runSync({
      eventName: "release",
      payload: {
        action: "published",
        ticketKey: issueKey,
        release: { draft: false, tag_name: releaseTag },
        releaseEvidence: evidence,
      },
      config,
      repository,
      actor,
      deliveryId: `${process.env.GITHUB_RUN_ID ?? "local"}:${issueKey}`,
      idempotencyStore,
    }),
  );
}

process.stdout.write(`${JSON.stringify({ manifest: manifest.sha256, results }, null, 2)}\n`);
