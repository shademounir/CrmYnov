import { readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const excluded = new Set([".git", ".terraform", "coverage", "node_modules"]);

export function comparePaths(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export async function findDockerfiles(directory, root = directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await findDockerfiles(path, root));
    else if (/^Dockerfile(?:\..+)?$/i.test(basename(path))) values.push(relative(root, path));
  }
  return values.sort(comparePaths);
}

export async function verifyContainerReadiness(root = process.cwd()) {
  const dockerfiles = await findDockerfiles(root);
  if (dockerfiles.length > 0) {
    throw new Error(
      `Container images now exist (${dockerfiles.join(", ")}); configure the pinned image build and Trivy image scan before merge.`,
    );
  }
  return "Container image scan deferred: no Dockerfile exists yet.\n";
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.stdout.write(await verifyContainerReadiness());
