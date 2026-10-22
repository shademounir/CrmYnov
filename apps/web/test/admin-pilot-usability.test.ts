import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

test("pilot form width overrides stay scoped and never widen ordinary forms", () => {
  const pools = readFileSync(new URL("../app/admin/assignment/pools/pools.css", import.meta.url), "utf8");
  const references = readFileSync(new URL("../app/references.css", import.meta.url), "utf8");
  const dom = new JSDOM(`<style>form {max-width:32rem}</style><style>${pools}\n${references}</style>
    <form id="ordinary"></form><section class="pool-admin"><form id="pool"></form></section>
    <section class="reference-admin"><form class="reference-fields" id="reference"></form></section>`);
  try {
    for (const id of ["pool", "reference"]) {
      const element = dom.window.document.getElementById(id)!;
      assert.equal(dom.window.getComputedStyle(element).maxWidth, "none");
      assert.equal(dom.window.getComputedStyle(element).width, "100%");
    }
    assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById("ordinary")!).maxWidth, "32rem");
  } finally { dom.window.close(); }
});

test("new campaign defaults to campus, editing preserves global scope, no automatic mutation", async t => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/admin/references" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client");
  const { default: ReferencesPage } = await import("../app/admin/references/page.js");
  const host = dom.window.document.getElementById("root")!, root = createRoot(host);
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let writes = 0;
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method && init.method !== "GET") writes++;
    const campus = { id: "synthetic-campus", code: "CAMPUS", label: "Campus synthétique", kind: "CAMPUS", state: "ACTIVE", scope: "GLOBAL", campusId: null, version: 1 };
    return Promise.resolve(Response.json({ items: url.includes("kind=CAMPAIGN") ? [{ ...campus, id: "synthetic-campaign", kind: "CAMPAIGN", code: "GLOBAL-CAMPAIGN", label: "Campagne globale existante" }] : [campus] }));
  });
  await act<void>(() => root.render(createElement(ReferencesPage)));
  const kind = host.querySelector("select")!;
  await act<void>(() => { kind.value = "CAMPAIGN"; kind.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  let form = host.querySelector("form")!;
  assert.equal(form.querySelector("select")?.value, "CAMPUS");
  assert.equal(form.querySelector<HTMLSelectElement>('[name="campusId"]')?.required, true);
  assert.equal(form.querySelector<HTMLSelectElement>('[name="campusId"]')?.value, "", "Do not guess a campus");
  assert.match(form.textContent, /ne réaffecte aucun dossier/);
  assert.equal(form.querySelector('a[href="/admin/assignment/pools"]')?.textContent, "Pools et nouveaux entrants");
  const edit = [...host.querySelectorAll("button")].find(b => b.textContent === "Modifier Campagne globale existante");
  assert.ok(edit);
  await act<void>(() => edit.click());
  form = host.querySelector("form")!;
  assert.equal(form.querySelector("select")?.value, "GLOBAL");
  assert.equal(form.querySelector('[name="campusId"]'), null);
  const cancel = [...form.querySelectorAll("button")].find(b => b.textContent === "Annuler la modification")!;
  await act<void>(() => cancel.click());
  assert.equal(host.querySelector("form select")?.getAttribute("name"), null);
  assert.equal(host.querySelector<HTMLSelectElement>("form select")?.value, "CAMPUS");
  assert.equal(writes, 0);
});
