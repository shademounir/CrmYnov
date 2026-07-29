import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ignoredDirectories = new Set([".git", "node_modules", "coverage"]);
const textExtensions = new Set([
  ".json",
  ".md",
  ".mjs",
  ".yml",
  ".yaml",
  ".gitignore",
]);

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await textFiles(fullPath)));
    } else if (
      textExtensions.has(path.extname(entry.name)) ||
      entry.name === ".gitignore"
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

test("repository contains no obvious secret, private key or service account", async () => {
  const patterns = [
    new RegExp(["gh", "p_[A-Za-z0-9]{20,}"].join("")),
    new RegExp(["github_pat", "_[A-Za-z0-9_]{20,}"].join("")),
    new RegExp(["AKIA", "[0-9A-Z]{16}"].join("")),
    new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"].join("")),
    new RegExp(['"type"\\s*:\\s*"', "service_account", '"'].join("")),
    new RegExp(['"private_', 'key_id"\\s*:'].join("")),
  ];
  const findings = [];

  for (const file of await textFiles(repositoryRoot)) {
    const content = await readFile(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        findings.push(path.relative(repositoryRoot, file));
      }
    }
  }

  assert.deepEqual(findings, []);
});

test("no real environment file is committed", async () => {
  const entries = await readdir(repositoryRoot, { withFileTypes: true });
  const environmentFiles = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(".env"))
    .map((entry) => entry.name)
    .filter((name) => name !== ".env.example");
  assert.deepEqual(environmentFiles, []);
});
