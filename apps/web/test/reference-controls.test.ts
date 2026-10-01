import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadReferences, LeadReferenceSelectors, referenceFormText, ReferenceSelect, type ReferenceOption } from "../app/_components/reference-controls.js";
import ReferencesPage from "../app/admin/references/page.js";
import { LeadTagsClient } from "../app/_components/lead-tags-client.js";
import { LeadReferencesClient } from "../app/_components/lead-references-client.js";
import { ProgramAvailability } from "../app/_components/program-availability.js";

const reference: ReferenceOption = { id: "synthetic-reference", kind: "TAG", code: "TEST", label: "Tag synthétique", scope: "GLOBAL", campusId: null, state: "ACTIVE", version: 1 };
test("reference selectors preserve explicit historic labels, required fields and accessible disabled state", () => {
  const historical = renderToStaticMarkup(createElement(ReferenceSelect, { name: "program", label: "Formation", options: [reference], value: "Ancienne valeur", onChange: () => undefined }));
  assert.match(historical, /Ancienne valeur — valeur historique conservée/); assert.match(historical, /required/); assert.match(historical, /Formation/);
  const active = renderToStaticMarkup(createElement(ReferenceSelect, { name: "tag", label: "Tag", options: [reference], value: "TEST", disabled: true, onChange: () => undefined }));
  assert.match(active, /disabled/); assert.doesNotMatch(active, /historique conservée/); assert.match(active, /min-height:44px/);
  assert.match(renderToStaticMarkup(createElement(LeadReferenceSelectors)), /Chargement des valeurs autorisées/);
  assert.match(renderToStaticMarkup(createElement(ReferencesPage)), /Tags et référentiels/);
});
test("lead controls initially disable tag mutations and show loading until server authorization is loaded", () => {
  const tags = renderToStaticMarkup(createElement(LeadTagsClient, { leadId: "synthetic/lead" }));
  assert.match(tags, /fieldset disabled/); assert.match(tags, /Chargement/); assert.match(tags, /\/leads\/synthetic%2Flead/);
  assert.doesNotMatch(tags, /Tags enregistrés/);
  const references = renderToStaticMarkup(createElement(LeadReferencesClient, { leadId: "synthetic-lead" }));
  assert.match(references, /historique inchangée est conservée/); assert.doesNotMatch(references, /<form/);
  const availability = renderToStaticMarkup(createElement(ProgramAvailability, { programId: "synthetic-program", campuses: [reference], revision: 0, onSave: () => Promise.resolve() }));
  assert.match(availability, /button type="submit" disabled/); assert.match(availability, /Choisir un campus/); assert.doesNotMatch(availability, /name="version"/);
});
test("reference loads are no-store, scoped, fail closed and never fetch a remote origin", async (context) => {
  let requested = "";
  context.mock.method(globalThis, "fetch", (url: string, init: RequestInit): Promise<Response> => { requested = url; assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin"); return Promise.resolve(Response.json({ items: [reference] })); });
  assert.deepEqual(await loadReferences("TAG", "campus-test", true, "lead-test"), [reference]);
  assert.ok(requested.startsWith("/api/crm/references?")); assert.match(requested, /campusId=campus-test/); assert.match(requested, /leadId=lead-test/);
  context.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 403 })));
  await assert.rejects(() => loadReferences("CAMPUS"), /accès refusé/);
  context.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ items: null })));
  await assert.rejects(() => loadReferences("TAG"), /invalide/);
});
test("form values reject file objects instead of stringifying uploads", () => {
  const form = new FormData(); form.set("label", "Synthétique"); form.set("file", new Blob(["synthetic"]), "synthetic.txt");
  assert.equal(referenceFormText(form, "label"), "Synthétique"); assert.equal(referenceFormText(form, "file"), ""); assert.equal(referenceFormText(form, "missing"), "");
});
