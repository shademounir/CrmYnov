import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const supported = new Set(["lint", "type-check", "build"]);
if (!supported.has(mode)) throw new Error(`Unsupported quality mode: ${mode ?? "missing"}.`);

const root = process.cwd();
const excluded = new Set([".git", ".terraform", "coverage", "node_modules"]);

async function filesBelow(directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await filesBelow(path));
    else values.push(path);
  }
  return values;
}

const files = await filesBelow(root);
const modules = files.filter((file) => extname(file) === ".mjs").sort();
const jsonFiles = files.filter((file) => extname(file) === ".json").sort();

if (mode === "lint" || mode === "type-check") {
  for (const file of modules) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "pipe", encoding: "utf8" });
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      throw new Error(`${mode} failed for ${relative(root, file)}.`);
    }
  }
}

if (mode === "build") {
  for (const file of jsonFiles) JSON.parse(await readFile(file, "utf8"));
}

process.stdout.write(`${mode} passed (${modules.length} modules, ${jsonFiles.length} JSON files).\n`);
