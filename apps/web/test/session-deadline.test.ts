import assert from "node:assert/strict";
import test from "node:test";
import { withSessionDeadline } from "../app/_components/session-deadline.js";
import { loadShellSession } from "../app/_components/app-shell.js";

test("a stalled session profile rejects at the deadline even when transport ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  const pending = loadShellSession((_input, init) => {
    signal = init?.signal;
    return new Promise<never>(() => undefined);
  });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  t.mock.timers.tick(20_000);
  await rejected;
  assert.equal(signal?.aborted, true);
});

test("route cancellation aborts profile reads and already-cancelled operations never start", async () => {
  const parent = new AbortController();
  let signal: AbortSignal | undefined;
  const pending = withSessionDeadline((value) => { signal = value; return new Promise<never>(() => undefined); }, parent.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  parent.abort();
  await rejected;
  assert.equal(signal?.aborted, true);
  let started = false;
  await assert.rejects(withSessionDeadline(() => { started = true; return Promise.resolve(true); }, parent.signal), { name: "AbortError" });
  assert.equal(started, false);
});

test("successful profile verification remains no-store, authenticated and clears its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  assert.equal((await loadShellSession((_input, init) => {
    signal = init?.signal;
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return Promise.resolve(Response.json({ roles: ["SUPER_ADMIN"], mustChangeSecret: false }));
  })).kind, "ready");
  t.mock.timers.tick(20_000);
  assert.equal(signal?.aborted, false);
});
