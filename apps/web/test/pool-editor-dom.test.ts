import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { PoolConfiguration } from "../app/admin/assignment/pools/pool-contract.js";

test("pool editor uses CRM names, explicit version confirmation and no blind replay after conflict or lost response", async t => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/admin/assignment/pools" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client");
  const { PoolEditor } = await import("../app/admin/assignment/pools/pool-editor.js");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async (): Promise<void> => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let saved: PoolConfiguration = { campusId: "synthetic-campus", version: 3, automaticEnabled: false, rules: [{ id: "synthetic-rule", scope: "GLOBAL", strategy: "CONTROLLED_RANDOM", balanceNewEntrants: true, enabled: true,
    candidates: [{ userId: "synthetic-adviser", active: true, capacity: 20, activeLeadCount: 0 }] }] };
  let mode: "success" | "conflict" | "lost" = "success", attempts = 0, confirmedWrites = 0;
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
    requests.push(url);
    assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin");
    if (url.includes("/references?")) return Promise.resolve(Response.json({ items: url.includes("kind=CAMPAIGN") ? [{ id: "campaign-id", code: "SYN-CAMPAIGN", label: "Campagne synthétique", state: "ACTIVE" }] : [{ id: "synthetic-campus", code: "SYN-CAMPUS", label: "Campus synthétique", state: "ACTIVE" }] }));
    if (url.includes("pool-administration?")) return Promise.resolve(Response.json({ campusId: "synthetic-campus", version: saved.version, fairnessScope: "CAMPUS_CONFIGURATION_VERSION_RULE_NEW_ENTRANTS",
      candidates: [{ id: "synthetic-adviser", label: "Alice Conseil CRM", activeLeadCount: 12 }, { id: "other-adviser", label: "Bruno Conseil CRM", activeLeadCount: 5 }],
      counters: [{ ruleId: "synthetic-rule", userId: "synthetic-adviser", label: "Alice Conseil CRM", assignedCount: saved.version === 3 ? 4 : 0 }] }));
    if (init?.method !== "PUT") return Promise.resolve(Response.json(saved));
    attempts++; assert.equal(url, "/api/crm/assignment/config"); assert.equal(typeof init.body, "string");
    const body = JSON.parse(init.body as string) as PoolConfiguration & { expectedVersion: number; confirmedNewCohort: boolean };
    assert.equal(body.confirmedNewCohort, true);
    assert.equal(body.campusId, "synthetic-campus"); assert.equal(body.expectedVersion, saved.version); assert.deepEqual(body.rules, saved.rules);
    if (mode === "conflict") return Promise.resolve(Response.json({ code: "assignment_version_conflict" }, { status: 409 }));
    saved = { ...saved, version: saved.version + 1 }; confirmedWrites++;
    if (mode === "lost") return Promise.reject(new TypeError("synthetic response lost after server commit"));
    return Promise.resolve(Response.json(saved));
  });
  const clickConfirmation = async (): Promise<void> => {
    const input = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(i => i.parentElement?.textContent?.includes("Je confirme")); assert.ok(input);
    await act<void>(() => input.click());
  };
  const submit = async (): Promise<void> => { const form = host.querySelector("form"); assert.ok(form); await act<void>(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); };
  const reload = async (): Promise<void> => { const button = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Actualiser la version")); assert.ok(button); await act<void>(() => button.click()); };
  await act<void>(() => root.render(createElement(PoolEditor)));
  const campus = host.querySelector<HTMLSelectElement>('select[name="pool-campus"]'); assert.ok(campus);
  await act<void>(() => { campus.value = "SYN-CAMPUS"; campus.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.match(host.textContent ?? "", /Alice Conseil CRM/); assert.match(host.textContent ?? "", /Bruno Conseil CRM/);
  assert.match(host.textContent ?? "", /Charge ouverte actuelle : 12/); assert.match(host.textContent ?? "", /version enregistrée : 4/);
  assert.doesNotMatch(host.textContent ?? "", /synthetic-adviser|other-adviser/);
  await submit(); assert.equal(attempts, 0, "No write without explicit confirmation");
  await clickConfirmation(); await submit(); assert.equal(attempts, 1); assert.equal(confirmedWrites, 1);
  assert.match(host.querySelector('[role="status"]')?.textContent ?? "", /version 4/);
  mode = "conflict"; await clickConfirmation(); await submit(); assert.equal(attempts, 2);
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /Conflit de version/);
  assert.equal(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
  await submit(); assert.equal(attempts, 2, "No automatic or blind manual replay");
  await reload(); mode = "lost"; await clickConfirmation(); await submit();
  assert.equal(attempts, 3); assert.equal(confirmedWrites, 2); assert.equal(saved.version, 5);
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /Aucun rejeu automatique/);
  await submit(); assert.equal(attempts, 3);
  await reload(); assert.match(host.textContent ?? "", /Version enregistrée : 5/); assert.equal(attempts, 3);
  assert.ok(requests.every(url => !url.includes("/users") && !url.includes("scheduled-sheets")), "No administrative directory and no Sheet activation");
});
