import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { parseReassignmentRecords, reassignmentError } from "../app/_components/reassignment-history.js";
import { assignmentIndicators } from "../app/manager/assignment/assignment-dashboard.js";
import { initialAssignmentMessage } from "../app/leads/lead-creation.js";

const request = { id: "request-synthetic", leadId: "lead-synthetic", currentOwnerId: "owner-synthetic", targetUserId: "target-synthetic", requestedBy: "requester-synthetic", reason: "Changement motivé de secteur", status: "PENDING", requestedAt: "2026-10-05T10:00:00Z", moveOpenTasks: true, version: 1, canDecide: true, currentOwnerLabel: "Commercial initial", targetUserLabel: "Commercial proposé", requesterLabel: "Demandeur synthétique", leadCode: "LD-SYNTHETIC" };

test("reassignment and creation projections fail closed and do not invent assignment success", () => {
  assert.equal(parseReassignmentRecords({ requests: [{ ...request, version: undefined }] })[0]?.canDecide, false);
  assert.equal(parseReassignmentRecords({ requests: [{ ...request, canDecide: false }] })[0]?.canDecide, false);
  assert.throws(() => parseReassignmentRecords({ requests: [{ ...request, status: "FAKE" }] }));
  assert.throws(() => parseReassignmentRecords({ items: [request] }));
  assert.deepEqual(assignmentIndicators({ leads: { total: 3, assigned: 2, unassigned: 1 }, activity: { pendingReassignments: 1 } }), { total: 3, assigned: 2, unassigned: 1, pending: 1 });
  assert.throws(() => assignmentIndicators({ leads: { total: "3", assigned: 2, unassigned: 1 }, activity: { pendingReassignments: 1 } }));
  assert.equal(initialAssignmentMessage({ outcome: "UNKNOWN" }), undefined);
  assert.match(initialAssignmentMessage({ outcome: "UNASSIGNED", reason: "assignment_candidate_unavailable", configurationVersion: 2 }) ?? "", /sans affectataire.*aucun Commercial.*À affecter/u);
  assert.match(initialAssignmentMessage({ outcome: "ASSIGNED", reason: "selected", configurationVersion: 3 }) ?? "", /même transaction.*v3/u);
  assert.match(initialAssignmentMessage({ outcome: "UNASSIGNED", reason: "assignment_automation_disabled", configurationVersion: 3 }) ?? "", /automatisation désactivée/u);
  assert.match(initialAssignmentMessage({ outcome: "UNASSIGNED", reason: "assignment_configuration_absent", configurationVersion: 0 }) ?? "", /configuration du campus absente/u);
  assert.doesNotMatch(initialAssignmentMessage({ outcome: "UNASSIGNED", reason: "assignment_configuration_absent", configurationVersion: 0 }) ?? "", /Configuration v0/u);
  assert.match(reassignmentError(401), /session a expiré/u);
});

async function environment(t: test.TestContext): Promise<{ dom: JSDOM; host: HTMLElement; act: typeof import("react").act; root: ReturnType<typeof import("react-dom/client").createRoot> }> {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manager/assignment" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, FormData: dom.window.FormData, DOMException: dom.window.DOMException, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"), { createRoot } = await import("react-dom/client");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async (): Promise<void> => {
    await act<void>(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  return { dom, host, root, act };
}

test("distinct Manager decision keeps its key after uncertainty, submits once concurrently and rereads final state", async (t) => {
  const { dom, host, root, act } = await environment(t);
  const { createElement } = await import("react"), { ReassignmentHistory } = await import("../app/_components/reassignment-history.js");
  let current = { ...request }; let writes = 0; const bodies: Array<Record<string, unknown>> = []; let complete = 0;
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "PATCH") {
      assert.equal(url, "/api/crm/reassignment-requests/request-synthetic/decision");
      assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.ok(typeof init.body === "string");
      const body = JSON.parse(init.body) as Record<string, unknown>; bodies.push(body); writes++;
      if (writes === 1) return Promise.reject(new Error("simulated_lost_response"));
      current = { ...current, status: "APPROVED", version: 2, canDecide: false };
      return Promise.resolve(Response.json({ request: { ...current, decisionReason: body.reason, transferredFollowUpCount: 2 } }));
    }
    assert.equal(url, "/api/crm/reassignment-requests"); return Promise.resolve(Response.json({ requests: [current] }));
  });
  await act<void>(() => { root.render(createElement(ReassignmentHistory, { onCompleted: () => { complete++; } })); });
  assert.match(host.textContent ?? "", /Commercial initial/u); assert.match(host.textContent ?? "", /reste inchangé/u);
  const form = host.querySelector("form"); assert.ok(form); const textarea = form.querySelector("textarea"); assert.ok(textarea); textarea.value = "Décision motivée pour ce dossier";
  assert.equal(textarea.maxLength, 500);
  textarea.value = "x".repeat(501);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(writes, 0); assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /4 à 500/u);
  textarea.value = "Décision motivée pour ce dossier";
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(writes, 1); assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /clé de décision.*conservées/u);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(writes, 2); assert.deepEqual(bodies[1], bodies[0]); assert.equal(bodies[0]?.approved, true); assert.equal(bodies[0]?.expectedVersion, 1);
  assert.equal(complete, 1); assert.equal(host.querySelector("form"), null); assert.match(host.querySelector('[role="status"]')?.textContent ?? "", /approuvée.*2 relance.*État relu/u);
  assert.match(host.textContent ?? "", /relances échues.*ne sont pas déplacés/u);
});

test("a request without server decision permission has no actionable decision form", async (t) => {
  const { host, root, act } = await environment(t);
  const { createElement } = await import("react"), { ReassignmentHistory } = await import("../app/_components/reassignment-history.js");
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ requests: [{ ...request, canDecide: false }] })));
  await act<void>(() => { root.render(createElement(ReassignmentHistory, { leadId: "lead-synthetic" })); });
  assert.equal(host.querySelector("form"), null); assert.match(host.textContent ?? "", /Manager ou Administrateur distinct/u);
});

test("pending reassignment prevents a second request after page reload and retains ownership", async (t) => {
  const { host, root, act } = await environment(t);
  const { createElement } = await import("react"), { AssignmentWorkflowForm } = await import("../app/leads/[leadId]/lead-workflow-forms.js");
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
    assert.notEqual(init?.method, "POST");
    return Promise.resolve(Response.json(url.endsWith("assignment-candidates") ? { candidates: [] } : { requests: [request] }));
  });
  await act<void>(() => { root.render(createElement(AssignmentWorkflowForm, { leadId: "lead-synthetic", assigned: true })); });
  assert.equal(host.querySelector("form"), null); assert.match(host.textContent ?? "", /en attente.*propriétaire reste inchangé/u);
  assert.equal(host.querySelector('a[href="/leads/lead-synthetic/collaborators"]')?.textContent, "Consulter la demande et sa décision");
});

test("owner request conserves key and intention after a lost response without promising unrelated task transfer", async (t) => {
  const { dom, host, root, act } = await environment(t);
  const { createElement } = await import("react"), { AssignmentWorkflowForm } = await import("../app/leads/[leadId]/lead-workflow-forms.js");
  const bodies: unknown[] = [];
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") { assert.ok(typeof init.body === "string"); bodies.push(JSON.parse(init.body)); if (bodies.length === 1) return Promise.reject(new Error("simulated_lost_response")); return Promise.resolve(Response.json(request)); }
    return Promise.resolve(Response.json(url.endsWith("assignment-candidates") ? { candidates: [{ id: "target-synthetic", label: "Commercial proposé", activeLeadCount: 0, capacity: 4 }] } : { requests: [] }));
  });
  await act<void>(() => { root.render(createElement(AssignmentWorkflowForm, { leadId: "lead-synthetic", assigned: true })); });
  const form = host.querySelector("form"); assert.ok(form); const select = form.querySelector("select"); assert.ok(select); select.value = "target-synthetic";
  const reason = form.querySelector("textarea"); assert.ok(reason); reason.value = "Changement motivé de secteur";
  assert.equal(reason.maxLength, 500);
  reason.value = "x".repeat(501);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(bodies.length, 0);
  reason.value = "Changement motivé de secteur";
  const transfer = form.querySelector<HTMLInputElement>('input[name="moveOpenTasks"]'); assert.ok(transfer); transfer.checked = true;
  assert.match(host.textContent ?? "", /relances planifiées du propriétaire actuel/u); assert.match(host.textContent ?? "", /relances échues, rendez-vous/u);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(bodies.length, 1);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(bodies.length, 2); assert.deepEqual(bodies[1], bodies[0]); assert.match(host.textContent ?? "", /en attente.*reste inchangé/u);
});
