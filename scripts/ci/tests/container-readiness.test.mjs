import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { comparePaths, findDockerfiles, verifyContainerReadiness } from "../container-readiness.mjs";

async function fixture(files = []) {
  const root = await mkdtemp(join(tmpdir(), "crmynov-container-readiness-"));
  for (const file of files) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "FROM scratch\n", "utf8");
  }
  return root;
}

test("sorts reversed and multiple textual paths deterministically", async (context) => {
  const root = await fixture(["z/Dockerfile", "a/Dockerfile.dev", "m/Dockerfile"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  const expected = [join("a", "Dockerfile.dev"), join("m", "Dockerfile"), join("z", "Dockerfile")];
  assert.deepEqual(await findDockerfiles(root), expected);
  assert.deepEqual(await findDockerfiles(root), expected);
});

test("preserves already ordered paths and ignores excluded directories", async (context) => {
  const root = await fixture(["a/Dockerfile", "b/Dockerfile.test", "node_modules/Dockerfile"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await findDockerfiles(root), [join("a", "Dockerfile"), join("b", "Dockerfile.test")]);

});

test("uses an explicit lexical comparator with stable equality and no input mutation", () => {
  assert.equal(comparePaths("same", "same"), 0);
  assert.equal(comparePaths("a", "b"), -1);
  assert.equal(comparePaths("b", "a"), 1);
  const input = ["b", "a", "b"];
  const sorted = input.toSorted(comparePaths);
  assert.deepEqual(sorted, ["a", "b", "b"]);
  assert.deepEqual(input, ["b", "a", "b"]);
});

test("requires exactly the two application Dockerfiles", async (context) => {
  const root = await fixture(["apps/api/Dockerfile", "apps/web/Dockerfile"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.match(await verifyContainerReadiness(root), /apps[\\/]api[\\/]Dockerfile/);

  const incomplete = await fixture(["apps/api/Dockerfile"]);
  context.after(() => rm(incomplete, { recursive: true, force: true }));
  await assert.rejects(
    verifyContainerReadiness(incomplete),
    /Expected exactly/,
  );
});
