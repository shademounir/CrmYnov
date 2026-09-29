import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("administration creates and rereads a scoped user, retaining input on refusal", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin/users" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { act, createElement } = await import("react"); const { createRoot } = await import("react-dom/client"); const { UsersConsole } = await import("../app/admin/users/users-console.js");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  let created = false; let refused = true; const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined; requests.push({ path, ...(body ? { body } : {}) });
    if (path.startsWith("/api/crm/references?")) return Promise.resolve(Response.json({ items: [{ id: "campus-a", label: "Campus A", code: "A", state: "ACTIVE" }] }));
    if (path === "/api/crm/users" && init?.method === "POST") { if (refused) return Promise.resolve(new Response(null, { status: 403 })); created = true; return Promise.resolve(Response.json({ id: "user-a", professionalEmail: "synthetic@example.invalid", roles: ["ADMISSIONS"], campusId: "campus-a", active: true })); }
    if (path === "/api/crm/users") return Promise.resolve(Response.json({ users: created ? [{ id: "user-a", professionalEmail: "synthetic@example.invalid", roles: ["ADMISSIONS"], campusId: "campus-a", active: true }] : [] }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  act(() => { root.render(createElement(UsersConsole)); });
  const form = dom.window.document.querySelector("form")!;
  const email = form.querySelector<HTMLInputElement>('input[name="professionalEmail"]')!;
  const campus = form.querySelector<HTMLSelectElement>('select[name="campusId"]')!;
  email.value = "synthetic@example.invalid"; campus.value = "campus-a";
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(email.value, "synthetic@example.invalid"); assert.match(dom.window.document.body.textContent ?? "", /Accès refusé/u);
  refused = false;
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.match(dom.window.document.body.textContent ?? "", /Compte créé et relu/u);
  const posts = requests.filter((item) => item.path === "/api/crm/users" && item.body);
  assert.deepEqual(posts[1]?.body, { professionalEmail: "synthetic@example.invalid", roles: ["ADMISSIONS"], campusId: "campus-a" });
  assert.ok(requests.filter((item) => item.path === "/api/crm/users" && !item.body).length >= 2);
});
