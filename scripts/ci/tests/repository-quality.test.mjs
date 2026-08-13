import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { executeQuality, filesBelow } from "../repository-quality.mjs";

async function fixture(entries) {
  const root = await mkdtemp(join(tmpdir(), "crmynov-repository-quality-"));
  for (const [file, content] of Object.entries(entries)) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return root;
}

test("discovers files recursively while excluding generated directories", async (context) => {
  const root = await fixture({ "valid.mjs": "export const valid = true;\n", "nested/data.json": "{}\n", "node_modules/ignored.mjs": "invalid" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const files = await filesBelow(root);
  assert.equal(files.length, 2);
  assert.ok(files.some((file) => file.endsWith("valid.mjs")));
  assert.ok(files.some((file) => file.endsWith("data.json")));
});

test("lint, type-check, and build validate real module and JSON inputs", async (context) => {
  const root = await fixture({ "valid.mjs": "export const valid = true;\n", "data.json": "{\"valid\":true}\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.match(await executeQuality("lint", root), /^lint passed/);
  assert.match(await executeQuality("type-check", root), /^type-check passed/);
  assert.match(await executeQuality("build", root), /^build passed/);
});

test("fails closed for unsupported modes, invalid modules, and invalid JSON", async (context) => {
  await assert.rejects(executeQuality("unknown"), /Unsupported quality mode/);

  const invalidModule = await fixture({ "invalid.mjs": "export const = ;\n" });
  context.after(() => rm(invalidModule, { recursive: true, force: true }));
  await assert.rejects(executeQuality("lint", invalidModule), /lint failed for invalid\.mjs/);

  const invalidJson = await fixture({ "invalid.json": "{" });
  context.after(() => rm(invalidJson, { recursive: true, force: true }));
  await assert.rejects(executeQuality("build", invalidJson), SyntaxError);
});
