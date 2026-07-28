import { writeFile } from "node:fs/promises";
import { createManifest } from "./index.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const version = argument("--version");
const targetCommit = argument("--sha");
const output = argument("--output") || "release-manifest.json";
const tickets = String(argument("--tickets") ?? "")
  .split(",")
  .map((ticket) => ticket.trim())
  .filter(Boolean);

const manifest = createManifest({ version, targetCommit, tickets });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
process.stdout.write(
  `${JSON.stringify({ output, ticketCount: manifest.tickets.length, sha256: manifest.sha256 })}\n`,
);
