import assert from "node:assert/strict";
import test from "node:test";
import { BlockReadMemo } from "../src/bootstrap-import/block-read-memo.js";

test("block reference reads deduplicate only inside the identical transaction", async () => {
  const memo = new BlockReadMemo<object>(), tx = {}, other = {}; let reads = 0;
  const load = async (): Promise<number> => ++reads;
  await memo.run(tx, async () => {
    assert.deepEqual(await Promise.all([memo.read(tx, "grants", load), memo.read(tx, "grants", load)]), [1, 1]);
    assert.equal(await memo.read(tx, "campus", load), 2);
    assert.equal(await memo.read(other, "grants", load), 3);
    assert.equal(await memo.read(other, "grants", load), 4);
  });
  assert.equal(await memo.read(tx, "grants", load), 5);
  assert.equal(await memo.read(tx, "grants", load), 6);
  await memo.run(tx, async () => assert.equal(await memo.read(tx, "grants", load), 7));
});

test("parallel and nested blocks never reuse another authorization snapshot", async () => {
  const memo = new BlockReadMemo<object>(), tx = {};
  const block = (value: number): Promise<number> => memo.run(tx, async () => {
    const first = await memo.read(tx, "grants", async () => value);
    await memo.run({}, async () => assert.equal(await memo.read(tx, "grants", async () => -1), -1));
    return memo.read(tx, "grants", async () => first + 100);
  });
  assert.deepEqual(await Promise.all([block(1), block(2)]), [1, 2]);
});

test("a failed block does not retain a failed read for the next transaction", async () => {
  const memo = new BlockReadMemo<object>(), tx = {};
  await assert.rejects(memo.run(tx, () => memo.read(tx, "grants", async () => { throw new Error("read failed"); })), /read failed/);
  assert.equal(await memo.run(tx, () => memo.read(tx, "grants", async () => 42)), 42);
});
