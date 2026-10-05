import assert from "node:assert/strict";
import test from "node:test";
import { withPreservedCleanup } from "../preserved-cleanup.mjs";

test("successful operation returns only after its cleanup", async () => {
  const order = [];
  const result = await withPreservedCleanup(async () => { order.push("operation"); return 42; }, async () => { order.push("cleanup"); });
  assert.equal(result, 42); assert.deepEqual(order, ["operation", "cleanup"]);
});

test("operation failure remains the original error after successful cleanup", async () => {
  const failure = new Error("test_failed"); let cleaned = false;
  await assert.rejects(withPreservedCleanup(() => { throw failure; }, () => { cleaned = true; }), (error_) => error_ === failure);
  assert.equal(cleaned, true);
});

test("cleanup failure prevents a successful operation from claiming success", async () => {
  const failure = new Error("stop_failed");
  await assert.rejects(withPreservedCleanup(() => 42, () => { throw failure; }), (error_) => error_ === failure);
});

test("both failures retain the original cause and the cleanup error without masking either", async () => {
  const operationFailure = new Error("test_failed"), cleanupFailure = new Error("identity_mismatch");
  await assert.rejects(withPreservedCleanup(async () => { throw operationFailure; }, async () => { throw cleanupFailure; }), (error_) => {
    assert.ok(error_ instanceof AggregateError); assert.equal(error_.cause, operationFailure);
    assert.deepEqual(error_.errors, [operationFailure, cleanupFailure]); return true;
  });
});

test("even a falsy thrown value remains a failure", async () => {
  let rejected = false;
  try { await withPreservedCleanup(() => { throw undefined; }, () => {}); }
  catch (error_) { rejected = true; assert.equal(error_, undefined); }
  assert.equal(rejected, true);
});
