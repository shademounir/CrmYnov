import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import { BlockReadMemo } from "../src/bootstrap-import/block-read-memo.js";
import { readBlockPackage } from "../src/bootstrap-import/block-package-read.js";

test("sealed source is read once per block but mutable package version/campus/state are always fresh", async () => {
  const memo = new BlockReadMemo<PermissionTransaction>();
  let version = 1, campusId = "campus-one", state = "MAPPED", fullReads = 0, sourceReads = 0, metadataReads = 0;
  const snapshot = { sheets: ["sealed evidence"] }, sealedAt = new Date("2026-10-22T10:00:00Z");
  const tx = { bootstrapImportPackage: { findUnique: (args: { select?: unknown; omit?: unknown }) => {
    if (args.select) { sourceReads++; return Promise.resolve({ snapshot }); }
    const current = { id: "package", version, campusId, state, sha256: "source", sealedAt };
    if (args.omit) { metadataReads++; return Promise.resolve(current); }
    fullReads++; return Promise.resolve({ ...current, snapshot });
  } } } as unknown as PermissionTransaction;
  await memo.run(tx, async () => {
    assert.equal((await readBlockPackage(tx, "package", memo))?.version, 1);
    version = 2; campusId = "campus-two"; state = "PARTIAL";
    const changed = await readBlockPackage(tx, "package", memo);
    assert.equal(changed?.version, 2); assert.equal(changed.campusId, "campus-two"); assert.equal(changed.state, "PARTIAL");
    assert.deepEqual(changed.snapshot, snapshot);
    assert.equal(sourceReads, 1); assert.equal(metadataReads, 2); assert.equal(fullReads, 0);
  });
  await readBlockPackage(tx, "package", memo); await readBlockPackage(tx, "package", memo);
  assert.equal(fullReads, 2, "Ordinary paths retain their original query");
  await memo.run(tx, async () => { await readBlockPackage(tx, "package", memo); });
  assert.equal(sourceReads, 2, "No source survives a completed block");
});

test("unsealed, missing and changed seal bindings cannot reuse a sealed snapshot", async () => {
  const memo = new BlockReadMemo<PermissionTransaction>();
  let sealedAt: Date | null = null, sha256 = "first", missing = false, sourceReads = 0, fullReads = 0;
  const tx = { bootstrapImportPackage: { findUnique: (args: { select?: unknown; omit?: unknown }) => {
    if (missing) return Promise.resolve(null);
    if (args.select) { sourceReads++; return Promise.resolve({ snapshot: { sha256 } }); }
    if (!args.omit) fullReads++;
    return Promise.resolve({ id: "package", sealedAt, sha256, ...(!args.omit ? { snapshot: {} } : {}) });
  } } } as unknown as PermissionTransaction;
  await memo.run(tx, async () => {
    await readBlockPackage(tx, "package", memo); await readBlockPackage(tx, "package", memo);
    assert.equal(sourceReads, 0); assert.equal(fullReads, 2);
    sealedAt = new Date("2026-10-22T10:00:00Z");
    await readBlockPackage(tx, "package", memo); sha256 = "second";
    assert.deepEqual((await readBlockPackage(tx, "package", memo))?.snapshot, { sha256: "second" });
    assert.equal(sourceReads, 2);
    missing = true; assert.equal(await readBlockPackage(tx, "package", memo), null);
  });
});
