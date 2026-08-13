import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const excluded = new Set([".git", ".terraform", "coverage", "node_modules"]);

async function findDockerfiles(directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await findDockerfiles(path));
    else if (/^Dockerfile(?:\..+)?$/i.test(basename(path))) values.push(relative(root, path));
  }
  return values.sort();
}

const dockerfiles = await findDockerfiles(root);
if (dockerfiles.length > 0) {
  throw new Error(
    `Container images now exist (${dockerfiles.join(", ")}); configure the pinned image build and Trivy image scan before merge.`,
  );
}

process.stdout.write("Container image scan deferred: no Dockerfile exists yet.\n");
