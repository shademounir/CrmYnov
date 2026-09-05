import assert from "node:assert/strict";
import test from "node:test";
import { createProxy } from "../app/api/crm/[...path]/route.js";

function relay(upstream: () => Response): ReturnType<typeof createProxy> {
  return createProxy({ apiOrigin: () => "http://api:3001", getSession: () => Promise.resolve("synthetic-session"), fetch: () => Promise.resolve(upstream()), randomId: () => "synthetic-correlation", production: true });
}

async function read(proxy: ReturnType<typeof createProxy>, path = "lead-views"): Promise<Response> {
  return proxy(new Request(`http://web.local/api/crm/${path}`), { params: Promise.resolve([path]).then((path) => ({ path })) });
}

for (const [name, raw] of [
  ["empty array", "[]"], ["multiple objects", '[ { "id": "synthetic-1" }, {"id":"synthetic-2"} ]'],
  ["object", '{ "name": "Synthétique" }'], ["paginated object", '{"items":[{"id":"synthetic"}],"total":1}'],
  ["null", "null"], ["string", '"Synthétique"'], ["number", "42"], ["boolean", "false"],
] as const) {
  test(`proxy preserves exact ${name} bytes, root type, status and Content-Type`, async () => {
    const response = await read(relay(() => new Response(raw, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(await response.text(), raw);
  });
}

for (const status of [200, 204, 205, 304]) {
  test(`proxy preserves empty response ${status} without manufacturing JSON`, async () => {
    const response = await read(relay(() => new Response(null, { status })));
    assert.equal(response.status, status);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("content-type"), null);
  });
}

for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
  test(`proxy preserves structured HTTP ${status} and safe operational headers`, async () => {
    const raw = JSON.stringify({ code: `synthetic_${status}`, detail: { expectedVersion: 1, actualVersion: 2 } });
    const response = await read(relay(() => new Response(raw, { status, headers: {
      "content-type": "application/problem+json", "retry-after": "60", "x-correlation-id": "upstream-synthetic", "x-request-id": "request-synthetic",
      "set-cookie": "upstream-session=synthetic; HttpOnly", authorization: "Bearer synthetic", connection: "keep-alive, x-internal-secret",
      "keep-alive": "timeout=10", "x-internal-secret": "synthetic", "transfer-encoding": "chunked", "content-encoding": "gzip", "content-length": "999",
    } })));
    assert.equal(response.status, status);
    assert.equal(await response.text(), raw);
    assert.equal(response.headers.get("content-type"), "application/problem+json");
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("x-correlation-id"), "upstream-synthetic");
    assert.equal(response.headers.get("x-request-id"), "request-synthetic");
    for (const name of ["set-cookie", "cookie", "authorization", "connection", "keep-alive", "x-internal-secret", "transfer-encoding", "content-encoding", "content-length"]) assert.equal(response.headers.get(name), null, name);
  });
}

test("regression n.map is not a function: successive view arrays remain arrays without residual state", async () => {
  const values = [[], [{ id: "synthetic-1" }, { id: "synthetic-2" }], []];
  let index = 0;
  const proxy = relay(() => Response.json(values[index++]));
  for (const expected of values) {
    const response = await read(proxy);
    const value: unknown = await response.json();
    assert.ok(Array.isArray(value));
    assert.deepEqual(value.map((item: { id: string }) => item.id), expected.map((item) => item.id));
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-correlation-id"), "synthetic-correlation");
  }
  assert.equal(index, 3);
});

test("token redaction retains the object shape on errors and never creates an authentication cookie", async () => {
  const response = await read(relay(() => Response.json({ code: "synthetic_conflict", token: "synthetic-token", items: [] }, { status: 409 })));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: "synthetic_conflict", items: [] });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("connection-nominated headers are not copied even when normally allowed", async () => {
  const response = await read(relay(() => new Response("[]", { headers: { connection: "Retry-After, X-Correlation-ID", "retry-after": "60", "x-correlation-id": "hop-only", "www-authenticate": "Bearer" } })));
  assert.equal(response.headers.get("retry-after"), null);
  assert.equal(response.headers.get("x-correlation-id"), null);
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
});
