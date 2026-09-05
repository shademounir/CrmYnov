import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateViewReader, sharedViewLink, sharingError, sharingRequest, sharingSnapshot, versionedCommand } from "../app/leads/shared-view-client.js";

test("shared view links contain only an identifier, never owner filters or permissions", () => {
  const url = new URL(sharedViewLink("synthetic-view"), "http://localhost");
  assert.deepEqual([...url.searchParams], [["sharedViewId", "synthetic-view"], ["page", "1"]]);
  const command = versionedCommand(3); assert.equal(command.expectedVersion, 3); assert.match(command.idempotencyKey, /^[a-f\d-]{36}$/);
  assert.notEqual(versionedCommand(3).idempotencyKey, command.idempotencyKey);
});
test("sharing snapshot loads owned/received/audience/history data without browser caching", async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", (path: string, init: RequestInit): Promise<Response> => {
    paths.push(path); assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.equal(init.method, "GET");
    return Promise.resolve(Response.json(path.startsWith("/api/crm/view-sharing/views/") ? { id: "private-synthetic", canEdit: false } : [{ id: path }]));
  });
  const result = await sharingSnapshot();
  assert.deepEqual(paths, ["/api/crm/lead-views", "/api/crm/view-sharing/received", "/api/crm/view-sharing/audiences", "/api/crm/view-sharing/history", "/api/crm/view-sharing/views/%2Fapi%2Fcrm%2Flead-views"]);
  assert.equal(result.owned[0]?.id, "private-synthetic"); assert.equal(result.owned[0]?.canEdit, false); assert.equal(result.received[0]?.id, paths[1]); assert.equal(result.audiences[0]?.id, paths[2]); assert.equal(result.history[0]?.id, paths[3]);
});
test("sharing writes preserve exact version and idempotency without client actor claims", async (t) => {
  const body = { expectedVersion: 2, idempotencyKey: "synthetic-revoke" };
  t.mock.method(globalThis, "fetch", (path: string, init: RequestInit): Promise<Response> => {
    assert.equal(path, "/api/crm/view-sharing/shares/synthetic/revoke"); assert.equal(init.method, "POST"); assert.equal(init.body, JSON.stringify(body));
    return Promise.resolve(Response.json({ version: 3 }));
  });
  assert.deepEqual(await sharingRequest("view-sharing/shares/synthetic/revoke", "POST", body), { version: 3 });
});
test("sharing surfaces controlled session, refusal, revocation, conflict and store errors without response details", async (t) => {
  let status = 403;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ diagnostic: "synthetic-do-not-expose" }, { status })));
  for (const code of [400, 401, 403, 404, 409, 503]) {
    status = code;
    await assert.rejects(() => sharingRequest("view-sharing/received"), (error: unknown) => error instanceof Error && error.message === sharingError(code) && !error.message.includes("synthetic-do-not-expose"));
  }
});

test("private lists coalesce only overlapping reads within one mounted screen, never across readers", async (t) => {
  const releases: ((response: Response) => void)[] = [];
  t.mock.method(globalThis, "fetch", (): Promise<Response> => new Promise((resolve) => { releases.push(resolve); }));
  const first = createPrivateViewReader<{ id: string }>();
  const otherScreen = createPrivateViewReader<{ id: string }>();
  const a = first.read(), b = first.read(), c = otherScreen.read();
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(releases.length, 2);
  releases[0]?.(Response.json([{ id: "synthetic-first" }]));
  releases[1]?.(Response.json([{ id: "synthetic-other" }]));
  assert.deepEqual(await a, [{ id: "synthetic-first" }]);
  assert.deepEqual(await c, [{ id: "synthetic-other" }]);
  const fresh = first.read();
  assert.notEqual(a, fresh);
  assert.equal(releases.length, 3);
  releases[2]?.(Response.json([]));
  assert.deepEqual(await fresh, []);
});

test("invalidation cannot reuse a pre-mutation read or let its late completion clear a newer read", async (t) => {
  const releases: ((response: Response) => void)[] = [];
  t.mock.method(globalThis, "fetch", (): Promise<Response> => new Promise((resolve) => { releases.push(resolve); }));
  const reader = createPrivateViewReader<{ id: string }>();
  const old = reader.read();
  reader.invalidate();
  const current = reader.read();
  assert.notEqual(old, current);
  releases[0]?.(Response.json([{ id: "synthetic-old" }]));
  await old;
  assert.equal(reader.read(), current);
  assert.equal(releases.length, 2);
  releases[1]?.(Response.json([{ id: "synthetic-current" }]));
  assert.deepEqual(await current, [{ id: "synthetic-current" }]);
});

test("failed private read is not retained and does not retry automatically", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => { requests++; return Promise.resolve(Response.json({ code: "permission_version_conflict" }, { status: 409 })); });
  const reader = createPrivateViewReader<{ id: string }>();
  await assert.rejects(reader.read(), /Actualisez/);
  assert.equal(requests, 1);
  await assert.rejects(reader.read(), /Actualisez/);
  assert.equal(requests, 2);
});

test("sharing snapshot accepts the shared private read and respects an aborted subscriber", async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", (path: string): Promise<Response> => { paths.push(path); return Promise.resolve(Response.json([])); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(sharingSnapshot(controller.signal, () => Promise.resolve([])), (e: unknown) => e instanceof DOMException && e.name === "AbortError");
  assert.equal(paths.includes("/api/crm/lead-views"), false);
  const result = await sharingSnapshot(undefined, () => Promise.resolve([]));
  assert.deepEqual(result.owned, []);
});
