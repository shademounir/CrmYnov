import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BootstrapWizard } from "../app/imports/bootstrap/bootstrap-wizard.js";
import { BootstrapMapping } from "../app/imports/bootstrap/bootstrap-mapping.js";
import { BootstrapRowReview } from "../app/imports/bootstrap/bootstrap-row-review.js";
import { HistoricalNotesList } from "../app/imports/bootstrap/historical-notes.js";
import { LeadProfileView, type LeadProfileRecord } from "../app/leads/[leadId]/lead-profile.js";
import { BootstrapApiError, bootstrapCapabilities, bootstrapChunkBytes, bootstrapFailure, bootstrapHash, bootstrapRequest, bytesToBase64, mappingForSheets, packageKey, stableBootstrapAttempt, type BootstrapContext, type BootstrapPackage, type BootstrapRow } from "../app/imports/bootstrap/bootstrap-client.js";

const campusId = "00000000-0000-4000-8000-000000000061";
const source: BootstrapPackage = { id: "00000000-0000-4000-8000-000000000062", fileName: "synthetic.xlsx", sizeBytes: 100, sha256: "a".repeat(64), campusId, state: "MAPPED", version: 3, receivedChunks: 1, expectedChunks: 1,
  sheets: [{ name: "VISITES ET APPELS", relationId: "rId1", rowCount: 2, columns: [{ letter: "A", name: "Nom" }] }], counts: { total: 2, accepted: 0, review: 1, invalid: 0, ignored: 0, pending: 1 } };
const context: BootstrapContext = { campuses: [{ id: campusId, label: "Campus synthétique", code: "SYNTHETIC", canUpload: true, canMap: true, canDecide: true, canConfirm: true }], owners: [], programs: [], campaigns: [], educationLevels: ["B1"], sources: ["OTHER"], statuses: ["PROSPECT", "ENROLLED"], canUpload: true, canMap: true, canDecide: true, canConfirm: true };

test("bootstrap hashes exact bytes and keeps decoded chunks inside both API/BFF bounds", async () => {
  const bytes = new Uint8Array(bootstrapChunkBytes).fill(65);
  const contentBase64 = bytesToBase64(bytes);
  assert.equal(contentBase64.length, 65536);
  assert.deepEqual(Buffer.from(contentBase64, "base64"), Buffer.from(bytes));
  const sha256 = await bootstrapHash(bytes.buffer);
  assert.match(sha256, /^[a-f0-9]{64}$/);
  assert.ok(new TextEncoder().encode(JSON.stringify({ index: 0, contentBase64, sha256 })).byteLength < 100 * 1024);
});

test("bootstrap context is fail closed for each selected campus, without cross-campus any-grant fallback", () => {
  assert.equal(bootstrapCapabilities(context, campusId).canConfirm, true);
  assert.equal(bootstrapCapabilities(context, "another-campus").canConfirm, false);
  assert.equal(bootstrapCapabilities(null, campusId).canUpload, false);
  const readOnly = { ...context, campuses: [{ id: campusId, label: "Campus synthétique", code: "SYNTHETIC" }] };
  assert.deepEqual(bootstrapCapabilities(readOnly, campusId), { canUpload: false, canMap: false, canDecide: false, canConfirm: false });
});

test("mapping starts without guessed campaigns, owners, names or column defaults", () => {
  assert.deepEqual(mappingForSheets(source), [{ name: "VISITES ET APPELS", campaign: "", fields: {}, commentColumns: [], ownerAliases: {} }]);
  assert.equal(packageKey("../../private"), undefined);
  assert.equal(packageKey(source.id), source.id);
});

test("an unchanged uncertain operation retains its idempotency key while changed content gets a new attempt", () => {
  const ref: { current: { payload: string; key: string } | undefined } = { current: undefined };
  const first = stableBootstrapAttempt(ref, { expectedVersion: 3, confirmed: true, limit: 25 });
  assert.equal(stableBootstrapAttempt(ref, { expectedVersion: 3, confirmed: true, limit: 25 }), first);
  assert.notEqual(stableBootstrapAttempt(ref, { expectedVersion: 4, confirmed: true, limit: 25 }), first);
});

test("historical notes preserve exact multiline/space text and never become today's commercial exchange or raw HTML", () => {
  const html = renderToStaticMarkup(createElement(HistoricalNotesList, { notes: [{ id: "note1", text: "  Texte exact\n<script>alert(1)</script>  ", sourceSheet: "VISITES ET APPELS", sourceRow: 7, sourceColumn: "O", author: null, occurredAt: null, importedAt: "2026-10-07T15:00:00Z" }], truncated: true }));
  assert.match(html, /date et auteur source inconnus/u);
  assert.ok(html.includes("  Texte exact\n&lt;script&gt;alert(1)&lt;/script&gt;  "));
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /pas date de l’échange/u);
  assert.match(html, /1 000 commentaires/u);
  assert.match(html, /cellule O7/u);
});

test("native author metadata remains a declared source author, never an authenticated CRM participant", () => {
  const html = renderToStaticMarkup(createElement(HistoricalNotesList, { notes: [{ id: "native1", text: "Texte historique exact", sourceSheet: "VISITES ET APPELS", sourceRow: 7, sourceColumn: "I", author: "Auteur déclaré dans Excel", occurredAt: null, importedAt: "2026-10-07T15:00:00Z" }] }));
  assert.match(html, /date source inconnue/u); assert.match(html, /Auteur source déclaré : Auteur déclaré dans Excel/u); assert.match(html, /pas une identité CRM authentifiée/u);
  assert.doesNotMatch(html, /date et auteur source inconnus/u);
});

test("historical provenance displays the server cycle, precise source and both source owners without making them today's assignment or closure", () => {
  const html = renderToStaticMarkup(createElement(HistoricalNotesList, { notes: [], provenance: [{ sheet: "JOBINTECH REACT", rowNumber: 29, cycleLabel: "Cycle à préciser", sourceOwner: "Alias initial", replacementOwner: "Alias nouveau à vérifier", originalSource: "Réactivation", rawStatus: "Ancienne inscription" }], provenanceTruncated: true }));
  for (const expected of ["Cycle à préciser", "Alias initial", "Alias nouveau à vérifier", "Réactivation", "Ancienne inscription", "pas une réaffectation", "provenance affichée est bornée"]) assert.ok(html.includes(expected));
  assert.equal(html.includes("React JS"), false); assert.equal(html.includes("2026–2027"), false);
});

test("a baseline profile refers to durable provenance rather than falsely declaring every historical cycle unspecified", () => {
  const lead: LeadProfileRecord = { id: "00000000-0000-4000-8000-000000000061", leadCode: "LD-SYN-BASELINE", firstName: "Recette", lastName: "Synthétique", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "B1", program: "SYNTHETIC", source: "OTHER", status: "PROSPECT", collaboratorIds: [], temperature: "UNEVALUATED", temperatureLabel: "Non évalué", qualificationVersion: 0, acquisitionKind: "BASELINE" };
  const html = renderToStaticMarkup(createElement(LeadProfileView, { lead, events: [] }));
  assert.match(html, /Cycle de reprise/u);
  assert.match(html, /Voir la provenance historique/u);
  assert.doesNotMatch(html, /À préciser · non déduit de la date d’import/u);
  assert.match(html, /Commentaires de reprise historique · provenance distincte/u);
});

test("source reception date retains its raw value, type, style and workbook epoch without guessing a candidature cycle", () => {
  const html = renderToStaticMarkup(createElement(HistoricalNotesList, { notes: [], provenance: [{ sheet: "VISITES ET APPELS", rowNumber: 7, cycleLabel: "Cycle à préciser", sourceOwner: null, replacementOwner: null, originalSource: null, rawStatus: null, receivedDateEvidence: { column: "A", reference: "A7", date1904: true, cell: { value: 46001, raw: "46001", type: "n", style: "date-style-14" } } }] }));
  for (const value of ["preuve source non interprétée", "46001", "Cellule A7", "type n", "1904", "date-style-14", "Cycle à préciser", "ne déduit aucune rentrée"]) assert.ok(html.includes(value), value);
  assert.equal(html.includes("2026–2027"), false);
});

test("a saved row decision is not an import receipt and cannot be silently edited again", () => {
  const row: BootstrapRow = { id: "row1", sheet: "VISITES ET APPELS", rowNumber: 7, version: 2, fingerprint: "b".repeat(64), state: "READY", reasons: [], values: { firstName: "Synthétique" }, comments: [], sourceOwner: null, replacementOwner: null, decision: { action: "CREATE_DOSSIER", reason: "Dossier distinct vérifié" } };
  const html = renderToStaticMarkup(createElement(BootstrapRowReview, { row, source, context, disabled: false, onDecision: async (): Promise<void> => {} }));
  assert.match(html, /pas encore un reçu d’import/u);
  assert.equal(html.includes("<form"), false);
  assert.match(html, /Cycle à préciser/u);
});

test("a durable decision reread separates source values from resolved corrections, target and qualified cycle", () => {
  const row: BootstrapRow = { id: "row1", sheet: "VISITES ET APPELS", rowNumber: 7, version: 2, fingerprint: "b".repeat(64), state: "READY", reasons: [], values: { firstName: "Source synthétique", status: "PROSPECT", ownerId: null }, comments: [], sourceOwner: null, replacementOwner: null,
    decision: { action: "LINK_EXISTING", reason: "Rapprochement synthétique vérifié", targetLeadId: "00000000-0000-4000-8000-000000000063", overrides: { ownerId: "owner-synthetic" }, resolvedValues: { firstName: "Correction synthétique", status: "ENROLLED", ownerId: "owner-synthetic" }, cycle: { state: "HISTORICAL_ENROLMENT", label: "2025-2026", sourceColumns: ["O"], reason: "Antériorité explicitement établie", evidence: [{ column: "O", reference: "O7", text: "  Inscription historique 2025-2026\n  ", formula: false }] } } };
  const html = renderToStaticMarkup(createElement(BootstrapRowReview, { row, source, context: { ...context, owners: [{ id: "owner-synthetic", label: "Responsable synthétique", campusId }] }, disabled: false, onDecision: async (): Promise<void> => {} }));
  for (const value of ["Valeurs source prévisualisées", "Source synthétique", "Valeurs résolues de la décision enregistrée", "Correction synthétique", "Responsable synthétique", "Dossier cible relu", "pas une nouvelle candidature", "2025-2026", "Cellules O7", "Preuves source du cycle relues", "  Inscription historique 2025-2026\n  "]) assert.ok(html.includes(value), value);
  assert.equal(html.includes("<form"), false);
  assert.match(html, /pas encore un reçu d’import/u);
});

test("native Excel annotations are escaped, visible and require explicit disposition instead of silently imported", () => {
  const row: BootstrapRow = { id: "row1", sheet: "VISITES ET APPELS", rowNumber: 7, version: 2, fingerprint: "b".repeat(64), state: "REVIEW", reasons: ["NATIVE_ANNOTATION_REVIEW"], values: {}, comments: [], sourceOwner: null, replacementOwner: null,
    annotations: [{ annotationId: "annotation1", reference: "I7", text: "  Annotation native\n<script>ne_pas_exécuter</script>  ", author: "Auteur source déclaré", relationshipId: "rId1" }] };
  const html = renderToStaticMarkup(createElement(BootstrapRowReview, { row, source, context, disabled: true, onDecision: async (): Promise<void> => {} }));
  assert.match(html, /disposition explicite requise/u); assert.match(html, /rien n’est importé par défaut/u); assert.ok(html.includes("Auteur source déclaré"));
  assert.ok(html.includes("  Annotation native\n&lt;script&gt;ne_pas_exécuter&lt;/script&gt;  ")); assert.equal(html.includes("<script>"), false);
});

test("source cells and formula/style evidence are readable before a row decision and remain escaped provenance", () => {
  const row: BootstrapRow = { id: "row1", sheet: "VISITES ET APPELS", rowNumber: 7, version: 2, fingerprint: "b".repeat(64), state: "REVIEW", reasons: ["UNMAPPED_SOURCE_CELL_REVIEW:O"], values: {}, comments: [], sourceOwner: null, replacementOwner: null, sourceEvidence: [
    { column: "O", reference: "O7", text: "  Inconnue <script>source</script>  ", raw: "Valeur brute", type: "inlineStr", formula: true, formulaText: 'HYPERLINK("https://example.invalid")', style: { fill: "yellow" } },
  ], sourceEvidenceTruncated: true };
  const html = renderToStaticMarkup(createElement(BootstrapRowReview, { row, source, context, disabled: true, onDecision: async (): Promise<void> => {} }));
  for (const value of ["à lire avant décision", "Cellule O7", "type inlineStr", "Valeur brute", "Formule source non exécutée", "yellow", "Preuve source tronquée"]) assert.ok(html.includes(value), value);
  assert.ok(html.includes("  Inconnue &lt;script&gt;source&lt;/script&gt;  ")); assert.equal(html.includes("<script>"), false); assert.equal(html.includes('<a href="https://example.invalid"'), false);
});

test("mapping never ignores an uncovered column by default and blocks an exclusion without its durable reason", () => {
  const mapping = { name: "VISITES ET APPELS", campaign: "SYNTHETIC", fields: { firstName: "B", lastName: "A", email: "C" }, commentColumns: [], ownerAliases: {}, excludedColumns: [{ column: "Z", reason: "" }] };
  const html = renderToStaticMarkup(createElement(BootstrapMapping, { source: { ...source, sheets: [{ name: mapping.name, relationId: "rId1", rowCount: 1, columns: [{ letter: "Z", name: "Ancienne colonne à qualifier" }] }] }, context, mappings: [mapping, { ...mapping, name: "LEADS YNOV.COM" }, { ...mapping, name: "LEADS YNOV.MA" }, { ...mapping, name: "JOBINTECH REACT" }], disabled: false, onChange: (): void => {}, onSave: (): void => {} }));
  assert.match(html, /aucun oubli silencieux/u); assert.match(html, /Exclure explicitement Z/u); assert.match(html, /huit caractères minimum/u);
  assert.match(html, /disabled=""[^>]*>Enregistrer le mapping R8/u);
});

test("wizard initial render is loading, not a fabricated successful empty report", () => {
  const html = renderToStaticMarkup(createElement(BootstrapWizard));
  assert.match(html, /Lecture du contexte/u);
  assert.doesNotMatch(html, /Reçus acquis|Traitement terminé/u);
});

test("oversized mapping envelopes fail locally before any request, without weakening the generic upload policy", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => { calls += 1; return Promise.resolve(Response.json({})); });
  await assert.rejects(bootstrapRequest("/packages/id/mappings", { method: "POST", body: "x".repeat(90 * 1024 + 1) }), (error: unknown) => error instanceof BootstrapApiError && error.status === 413);
  assert.equal(calls, 0);
});

test("bootstrap uses only canonical same-origin BFF and never includes secrets or source values in its generic errors", async (t) => {
  let captured: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(path, "/api/crm/lead-import/bootstrap/context"); captured = init;
    return Promise.resolve(Response.json({ code: "private@example.invalid" }, { status: 403 }));
  });
  await assert.rejects(bootstrapRequest("/context"), (error: unknown) => { assert.match(bootstrapFailure(error), /périmètre/u); assert.equal(bootstrapFailure(error).includes("private@example.invalid"), false); return true; });
  assert.equal(captured?.credentials, "same-origin"); assert.equal(captured?.cache, "no-store");
  assert.match(bootstrapFailure(new BootstrapApiError(401, "secret")), /session a expiré/u);
  assert.match(bootstrapFailure(new BootstrapApiError(409, "secret")), /version ou le contenu a changé/u);
});
