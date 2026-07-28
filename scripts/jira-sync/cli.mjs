import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import { runSync } from "./runner.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const eventPath = argument("--event") || process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  throw new Error("A GitHub event file is required.");
}

const payload = JSON.parse(await readFile(eventPath, "utf8"));
const config = loadConfig();
const eventName = argument("--event-name") || process.env.GITHUB_EVENT_NAME;
const result = await runSync({
  eventName,
  payload,
  config,
  repository: process.env.GITHUB_REPOSITORY,
  actor: process.env.GITHUB_ACTOR,
  deliveryId: process.env.GITHUB_RUN_ID,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
