import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const supported = new Set(["lint", "type-check", "build"]);
const excluded = new Set([".git", ".terraform", "coverage", "node_modules"]);

export async function filesBelow(directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await filesBelow(path));
    else values.push(path);
  }
  return values;
}

export async function executeQuality(mode, root = process.cwd()) {
  if (!supported.has(mode)) throw new Error(`Unsupported quality mode: ${mode ?? "missing"}.`);
  const files = await filesBelow(root);
  const modules = files.filter((file) => extname(file) === ".mjs").sort();
  const jsonFiles = files.filter((file) => extname(file) === ".json").sort();

  if (mode === "lint" || mode === "type-check") {
    for (const file of modules) {
      const result = spawnSync(process.execPath, ["--check", file], { stdio: "pipe", encoding: "utf8" });
      if (result.status !== 0) {
        throw new Error(`${mode} failed for ${relative(root, file)}: ${result.stderr.trim()}`);
      }
    }
  }

  if (mode === "build") {
    for (const file of jsonFiles) JSON.parse(await readFile(file, "utf8"));
  }
  return `${mode} passed (${modules.length} modules, ${jsonFiles.length} JSON files).\n`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.stdout.write(await executeQuality(process.argv[2]));
