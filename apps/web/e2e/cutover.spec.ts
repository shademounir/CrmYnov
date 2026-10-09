import { expect, test, type Page, type Route } from "@playwright/test";
import type { CutoverContext, CutoverEffect, CutoverExceptions, CutoverManifest } from "../app/imports/cutover/cutover-client.js";

const ids = { manifest: "00000000-0000-4000-8000-000000000063", campus: "00000000-0000-4000-8000-000000000061", package: "00000000-0000-4000-8000-000000000062", connector: "00000000-0000-4000-8000-000000000064", lead: "00000000-0000-4000-8000-000000000065" };
const manifestPath = `/api/crm/lead-import/cutover/manifests/${ids.manifest}`;
const context: CutoverContext = { campuses: [{ id: ids.campus, label: "Campus synthétique de recette", canCreate: true }], connectors: [{ id: ids.connector, campusId: ids.campus, label: "Source synthétique durable · aucun fichier réel", enabled: false, identityMode: "EXTERNAL_ID", sourceSheetId: 0 }] };
const effect: CutoverEffect = { id: "00000000-0000-4000-8000-000000000066", sourceKey: "1".repeat(64), outcome: "CREATED", batchId: "00000000-0000-4000-8000-000000000067", reason: null, compensationStatus: null, compensationReason: null, createdAt: "2026-10-09T10:00:00.000Z", comparedAt: null, leadVisible: true, leadId: ids.lead };
function exceptionsFixture(): CutoverExceptions {
  return { id: ids.manifest, version: 4, state: "BASELINED", bindingValid: true,
    observation: { sourceEvidenceSha256: "a".repeat(64), bindingSha256: "b".repeat(64), headerSha256: "c".repeat(64), observedAt: "2026-10-09T10:00:00.000Z", observedManifestVersion: 4 },
    cases: [{ id: "00000000-0000-4000-8000-000000000071", sourceKey: "1".repeat(64), kind: "SOURCE_CHANGED", evidenceSha256: "2".repeat(64), generation: 1, present: true, originalFingerprint: "2".repeat(64), observedFingerprint: "4".repeat(64), observedOriginalArrivedAt: "2026-10-09T09:01:00.000Z", effectId: effect.id, batchId: effect.batchId, reasonCode: null, disposition: null, current: true, requiresReobservation: false }],
    summary: { currentCases: 1, unresolvedCases: 1, quarantinedCases: 0, uniqueQuarantinedSources: 0, coverageValid: true, requiresReobservation: false, allDispositionsReconciled: false }, capabilities: { canQuarantine: true, canObserve: true } };
}
function fixture(overrides: Partial<CutoverManifest> = {}): CutoverManifest {
  return { id: ids.manifest, campusId: ids.campus, state: "READY_FOR_CATCHUP", version: 4, contract: { bootstrapPackageId: ids.package, connectorId: ids.connector, excelSha256: "a".repeat(64), configurationSha256: "b".repeat(64), t0: "2026-10-09T09:00:00.000Z", timeZone: "Africa/Casablanca", excelFrozenAt: "2026-10-09T09:00:00.000Z", originalArrivalColumn: "original_arrived_at", externalIdColumn: "submission_id", identityEvidenceSha256: "c".repeat(64), sourceSheetId: 0 }, counts: { total: 2, excludedPreT0: 1, backlog: 1, overlapReview: 0, sourceIssues: 0, linkedBaseline: 0, keptForCatchup: 1 }, sourceCount: 2, headerSha256: "d".repeat(64), snapshotSha256: "e".repeat(64), observedAt: "2026-10-09T10:00:00.000Z", reportSha256: "f".repeat(64), suspensionReason: null, localT0: new Intl.DateTimeFormat("fr-MA", { timeZone: "Africa/Casablanca", dateStyle: "full", timeStyle: "long" }).format(new Date("2026-10-09T09:00:00.000Z")), submissions: [{ key: "1".repeat(64), externalId: "SYNTHETIC-POST-T0-ONE", fingerprint: "2".repeat(64), originalArrivedAt: "2026-10-09T09:01:00.000Z", classification: "BACKLOG", issue: null, decision: "KEEP_FOR_CATCHUP", targetBootstrapRowId: null }, { key: "3".repeat(64), externalId: "SYNTHETIC-OLD-ONE", fingerprint: "4".repeat(64), originalArrivedAt: "2026-10-08T09:01:00.000Z", classification: "EXCLUDED_PRE_T0", issue: null, decision: null, targetBootstrapRowId: null }], automaticActivationAvailable: false, effectsApplied: true, compensationApplied: false, bindingValid: true, capabilities: { canObserve: true, canDecide: true, canReconcile: true, canSuspend: true, canResume: false, canConsume: false, canCompensate: true }, effects: [effect], catchup: { total: 1, created: 1, linkedBaseline: 0, review: 0, pending: 0, complete: true }, limitations: ["SOURCE_IDENTITY_EVIDENCE_DECLARED_NOT_UPSTREAM_ATTESTED", "AUTOMATIC_CATCHUP_NOT_IMPLEMENTED", "RECOVERABLE_COMPENSATION_NOT_IMPLEMENTED", "LOCAL_ROW_NOT_SUPPORTED", "SHEETS_REMAINS_DISABLED"], ...overrides };
}
function sourceExceptionManifest(): CutoverManifest {
  const before = fixture(); return { ...before, state: "BASELINED", reportSha256: null, counts: { ...before.counts, sourceIssues: 1 }, submissions: before.submissions.map((entry) => entry.key === "1".repeat(64) ? { ...entry, issue: "SOURCE_CHANGED" } : entry), capabilities: { ...before.capabilities!, canReconcile: false, canConsume: false }, catchup: { ...before.catchup!, complete: false } };
}
interface Write { path: string; body: Record<string, unknown> }
interface MockOptions { contextStatus?: number; readStatus?: number; exceptionsStatus?: number; exceptions?: CutoverExceptions; initial?: CutoverManifest; onWrite?: (route: Route, write: Write, setManifest: (value: CutoverManifest) => void) => Promise<void> }
async function mockCutover(page: Page, options: MockOptions = {}): Promise<Write[]> {
  const writes: Write[] = []; let manifest = options.initial ?? fixture();
  // Browser contracts only: every API request is intercepted. No real account,
  // Sheet, source observation, import, grant or persistent receipt is created.
  await page.route("**/api/crm/**", async (route) => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (method !== "GET") {
      const raw: unknown = route.request().postDataJSON();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Synthetic mutation body must be an object");
      const write = { path, body: raw as Record<string, unknown> }; writes.push(write);
      if (options.onWrite) return options.onWrite(route, write, (value) => { manifest = value; });
      return route.fulfill({ status: 403, json: { code: "unexpected_synthetic_mutation" } });
    }
    if (path === "/api/crm/lead-import/cutover/context") return route.fulfill({ status: options.contextStatus ?? 200, json: options.contextStatus ? { code: "PRIVATE_SYNTHETIC_CONTEXT_DETAIL" } : context });
    if (path === manifestPath) return route.fulfill({ status: options.readStatus ?? 200, json: options.readStatus ? { code: "PRIVATE_SYNTHETIC_READ_DETAIL" } : manifest });
    if (path === `${manifestPath}/exceptions`) return route.fulfill({ status: options.exceptionsStatus ?? 200, json: options.exceptionsStatus ? { code: "PRIVATE_EXCEPTION_READ_DETAIL" } : options.exceptions ?? exceptionsFixture() });
    if (path.endsWith("/sessions/current")) return route.fulfill({ json: { roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], professionalEmail: "cutover-synthetic@example.invalid", mustChangeSecret: false } });
    if (path.endsWith("/reports/dashboard/capabilities")) return route.fulfill({ json: { canViewPersonalDashboard: true, canViewPilotageDashboard: false } });
    if (path.endsWith("/telephony/me")) return route.fulfill({ json: { global: { enabled: false, mode: "DISABLED" }, profile: null, workstation: null, readiness: { available: false, reason: "MODE_DISABLED" }, canPair: false, canRevoke: false, inboundEnabled: false, recordingEnabled: false } });
    if (path.endsWith("/admissions/context")) return route.fulfill({ json: { timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, canUseAgenda: false, campuses: [], eligibleUsers: [] } });
    if (path.endsWith("/notifications")) return route.fulfill({ json: { items: [], unread: 0, total: 0, page: 1, pageSize: 1 } });
    if (path.endsWith("/leads")) return route.fulfill({ json: { items: [], page: 1, pageSize: 100, total: 0 } });
    return route.fulfill({ status: 503, json: { code: "synthetic_endpoint_not_implemented" } });
  });
  return writes;
}
async function assertContained(page: Page, width: number): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; });
  const layout = await page.locator("main.cutover-page").evaluate((element) => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth, overflow: [...element.querySelectorAll(".cutover-card,.cutover-fields,.cutover-metadata,.cutover-counts,.cutover-actions,.cutover-submission,button,input:not([type=checkbox]),select,textarea")].filter((item) => {
    const rect = item.getBoundingClientRect();
    // Native single-line text inputs scroll their editable value internally.
    // That is not a layout overflow: their outer bounds must still be contained,
    // and the full prefilled identifier is checked with the keyboard below.
    const editableText = item instanceof HTMLInputElement && item.type === "text";
    return rect.width > 0 && (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1 || !editableText && item.scrollWidth > item.clientWidth + 1);
  }).map((item) => item.className || item.tagName) }));
  expect(layout.documentWidth, `Document cutover at ${width}px`).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.overflow, `Cards, source hashes and controls at ${width}px`).toEqual([]);
  const controls = page.locator("main.cutover-page :is(button,select,input:not([type=checkbox]),textarea)");
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const size = await control.boundingBox(); expect(size?.height).toBeGreaterThanOrEqual(44);
  }
}

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`cutover preparation and durable receipts stay contained at ${width}px without implicit creation`, async ({ page }, testInfo) => {
    const writes = await mockCutover(page, { initial: sourceExceptionManifest() }); await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/imports/cutover?package=${ids.package}`);
    await expect(page.getByRole("heading", { name: "Préparer le gel et la frontière T0", exact: true })).toBeVisible();
    await expect(page.getByLabel("Frontière T0 · instant UTC")).toHaveValue(""); await expect(page.getByLabel("Gel final Excel · instant UTC")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Enregistrer le manifeste préparatoire", exact: true })).toBeDisabled();
    await assertContained(page, width); expect(writes).toHaveLength(0);
    const packageInput = page.getByLabel("Identifiant du lot Excel scellé"); await packageInput.focus(); await expect(packageInput).toBeFocused();
    await expect(packageInput).toHaveValue(ids.package); await packageInput.press("Control+A");
    expect(await packageInput.evaluate((input: HTMLInputElement) => ({ start: input.selectionStart, end: input.selectionEnd }))).toEqual({ start: 0, end: ids.package.length });
    await packageInput.press("End");
    expect(await packageInput.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(ids.package.length);
    await page.screenshot({ path: testInfo.outputPath(`cutover-preparation-${width}.png`), fullPage: true, animations: "disabled" });
    await page.goto(`/imports/cutover?manifest=${ids.manifest}`);
    await expect(page.getByRole("heading", { name: "Point de reprise durable", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Reçu ${effect.id}`, exact: true })).toBeVisible();
    await expect(page.getByText("Historique exclu", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ouvrir la fiche autorisée", exact: true })).toHaveAttribute("href", `/leads/${ids.lead}`);
    await expect(page.getByText(/Exceptions non encore lues/u)).toBeVisible();
    await page.getByRole("button", { name: "Lire les exceptions sans exécuter", exact: true }).click();
    const exceptions = page.getByRole("region", { name: "Exceptions de source conservées", exact: true });
    await expect(exceptions.getByRole("heading", { name: "Incident de modification conservé", exact: true })).toBeVisible();
    await expect(exceptions.getByRole("button", { name: "Préserver cette preuve en quarantaine", exact: true })).toBeDisabled();
    await exceptions.locator("summary").click(); await expect(exceptions.getByText("a".repeat(64), { exact: true })).toBeVisible();
    await expect(exceptions).toContainText("Un effet en revue reste en revue");
    await assertContained(page, width);
    const refresh = page.getByRole("button", { name: "Actualiser sans exécuter", exact: true }); await refresh.focus(); await expect(refresh).toBeFocused(); await refresh.click();
    await expect(page.getByRole("status").filter({ hasText: "État durable relu" })).toBeVisible(); await page.reload();
    await expect(page.getByRole("heading", { name: `Reçu ${effect.id}`, exact: true })).toBeVisible(); expect(writes).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath(`cutover-receipts-${width}.png`), fullPage: true, animations: "disabled" });
  });
}

for (const [status, message] of [[401, /Votre session a expiré/u], [403, /périmètre actuel/u], [503, /n’a pas confirmé le résultat/u]] as const) {
  test(`exception proof read ${status} is honest and never mutates a source`, async ({ page }) => {
    const writes = await mockCutover(page, { initial: sourceExceptionManifest(), exceptionsStatus: status }); await page.goto(`/imports/cutover?manifest=${ids.manifest}`);
    await page.getByRole("button", { name: "Lire les exceptions sans exécuter", exact: true }).click();
    const exceptions = page.getByRole("region", { name: "Exceptions de source conservées", exact: true });
    await expect(exceptions.getByRole("alert")).toContainText(message); await expect(exceptions).not.toContainText("PRIVATE_EXCEPTION_READ_DETAIL");
    await expect(exceptions.locator("form")).toHaveCount(0); expect(writes).toHaveLength(0);
  });
}

test("quarantine is explicit and an uncertain replay retains exact proof, reason, version and key", async ({ page }) => {
  const writes = await mockCutover(page, { initial: sourceExceptionManifest(), onWrite: async (route, write) => { expect(write.path).toBe(`${manifestPath}/exceptions/00000000-0000-4000-8000-000000000071/disposition`); await route.fulfill({ status: 503, json: { code: "PRIVATE_UNCERTAIN_QUARANTINE" } }); } });
  await page.goto(`/imports/cutover?manifest=${ids.manifest}`); await page.getByRole("button", { name: "Lire les exceptions sans exécuter", exact: true }).click();
  const exceptions = page.getByRole("region", { name: "Exceptions de source conservées", exact: true });
  const submit = exceptions.getByRole("button", { name: "Préserver cette preuve en quarantaine", exact: true }); await expect(submit).toBeDisabled();
  await exceptions.getByLabel("Motif de préservation en quarantaine").fill("Preuve synthétique à conserver sans modifier le reçu antérieur"); await expect(submit).toBeDisabled();
  await exceptions.getByRole("checkbox", { name: /Je préserve cette preuve précise/u }).check(); await submit.click();
  await expect(exceptions.getByRole("alert")).toContainText("Le serveur n’a pas confirmé le résultat");
  await expect(exceptions.getByLabel("Motif de préservation en quarantaine")).toBeDisabled();
  await exceptions.getByRole("button", { name: "Relire les exceptions sans exécuter", exact: true }).click();
  await exceptions.getByRole("button", { name: "Rejouer exactement la disposition en attente", exact: true }).click();
  expect(writes).toHaveLength(2); expect(writes[1]!.body).toEqual(writes[0]!.body);
  expect(writes[0]!.body).toMatchObject({ expectedVersion: 4, evidenceSha256: "2".repeat(64), action: "QUARANTINE_PRESERVE", confirmed: true });
  await expect(exceptions).not.toContainText("PRIVATE_UNCERTAIN_QUARANTINE"); await expect(exceptions).not.toContainText("Disposition et reçu relus");
});

test("a persisted quarantine rereads its exact case and leaves REVIEW, effect and batch untouched", async ({ page }) => {
  const exceptions = exceptionsFixture(), reviewEffect: CutoverEffect = { ...effect, outcome: "REVIEW", reason: "SYNTHETIC_REVIEW", leadVisible: false }; delete reviewEffect.leadId;
  const before = fixture({ state: "BASELINED", reportSha256: null, effects: [reviewEffect], catchup: { total: 1, created: 0, linkedBaseline: 0, review: 1, pending: 0, complete: false }, capabilities: { ...fixture().capabilities!, canReconcile: false, canConsume: false, canCompensate: false } });
  exceptions.cases[0]!.kind = "EFFECT_REVIEW"; exceptions.cases[0]!.observedFingerprint = "2".repeat(64); exceptions.cases[0]!.reasonCode = "SYNTHETIC_REVIEW";
  const writes = await mockCutover(page, { initial: before, exceptions, onWrite: async (route, write, setManifest) => {
    expect(write.path).toBe(`${manifestPath}/exceptions/00000000-0000-4000-8000-000000000071/disposition`);
    const reason = String(write.body.reason), actorId = "synthetic-reviewer", decidedAt = "2026-10-09T11:00:00.000Z";
    exceptions.version = 5; exceptions.state = "SUSPENDED";
    exceptions.cases[0]!.disposition = { action: "QUARANTINE_PRESERVE", reason, actorId, decidedAt, decidedManifestVersion: 5 };
    exceptions.cases[0]!.requiresReobservation = true;
    exceptions.summary = { ...exceptions.summary, unresolvedCases: 0, quarantinedCases: 1, uniqueQuarantinedSources: 1, coverageValid: false, requiresReobservation: true, allDispositionsReconciled: false };
    exceptions.capabilities.canQuarantine = false;
    setManifest({ ...before, version: 5, state: "SUSPENDED", suspensionReason: "cutover_quarantine_requires_reobservation", capabilities: { ...before.capabilities!, canObserve: true, canReconcile: false, canConsume: false } });
    await route.fulfill({ json: { ...exceptions, receipt: { caseId: exceptions.cases[0]!.id, evidenceSha256: exceptions.cases[0]!.evidenceSha256, action: "QUARANTINE_PRESERVE", reason, actorId, decidedAt }, replayed: false } });
  } });
  await page.goto(`/imports/cutover?manifest=${ids.manifest}`); await page.getByRole("button", { name: "Lire les exceptions sans exécuter", exact: true }).click();
  const panel = page.getByRole("region", { name: "Exceptions de source conservées", exact: true });
  await panel.getByLabel("Motif de préservation en quarantaine").fill("Conserver cette preuve synthétique sans résoudre l’effet en revue");
  await panel.getByRole("checkbox", { name: /Je préserve cette preuve précise/u }).check(); await panel.getByRole("button", { name: "Préserver cette preuve en quarantaine", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Disposition et reçu relus"); await expect(panel.getByText("Quarantaine préservée · non ingérée", { exact: true })).toBeVisible();
  await expect(panel).toContainText("Un effet en revue reste en revue"); await expect(panel).toContainText(effect.id); await expect(panel).toContainText(effect.batchId!);
  await expect(panel.locator("form")).toHaveCount(0); await expect(page.getByRole("button", { name: "Observer la source désactivée", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Vérifier la réconciliation", exact: true })).toBeDisabled(); expect(writes).toHaveLength(1);
});

test("creation refuses an earlier freeze and accepts Z or .000Z only for the same explicitly supplied instant", async ({ page }) => {
  const writes = await mockCutover(page, { onWrite: async (route, write, setManifest) => {
    expect(write.path).toBe("/api/crm/lead-import/cutover/manifests");
    expect(write.body).toMatchObject({ t0: "2026-10-01T08:00:00.000Z", excelFrozenAt: "2026-10-01T08:00:00.000Z" });
    const after = fixture({ state: "DRAFT", version: 1, effects: [], effectsApplied: false, contract: { ...fixture().contract, t0: "2026-10-01T08:00:00.000Z", excelFrozenAt: "2026-10-01T08:00:00.000Z" } });
    setManifest(after); await route.fulfill({ status: 201, json: after });
  } });
  await page.goto(`/imports/cutover?package=${ids.package}`);
  await expect(page.getByText(/Le snapshot Excel final, incluant le delta/u)).toBeVisible();
  await page.getByLabel("Connecteur autorisé, désactivé").selectOption(ids.connector);
  await page.getByLabel("Gel final Excel · instant UTC").fill("2026-10-01T08:00:00Z");
  await expect(page.getByLabel("Frontière T0 · instant UTC")).toHaveValue("");
  await page.getByLabel("Frontière T0 · instant UTC").fill("2026-10-01T09:00:00Z");
  await page.getByLabel("Identifiant numérique de l’onglet source").fill("0");
  await page.getByLabel("Colonne d’arrivée originale UTC").fill("original_arrived_at");
  await page.getByLabel("SHA-256 de la preuve d’identité amont").fill("c".repeat(64));
  const confirmation = page.getByRole("checkbox", { name: /Les références et instants ont été vérifiés/u }); await confirmation.check();
  const submit = page.getByRole("button", { name: "Enregistrer le manifeste préparatoire", exact: true });
  await expect(submit).toBeDisabled(); expect(writes).toHaveLength(0);
  await expect(page.getByLabel("Gel final Excel · instant UTC")).toHaveValue("2026-10-01T08:00:00Z");
  await page.getByLabel("Frontière T0 · instant UTC").fill("2026-10-01T08:00:00.000Z");
  await expect(confirmation).not.toBeChecked(); await confirmation.check(); await expect(submit).toBeEnabled(); await submit.click();
  await expect(page.getByRole("heading", { name: "Point de reprise durable", exact: true })).toBeVisible(); expect(writes).toHaveLength(1);
});

for (const [status, message] of [[401, /Votre session a expiré/u], [403, /périmètre actuel/u], [503, /n’a pas confirmé le résultat/u]] as const) {
  test(`cutover context ${status} shows an honest unavailable state without writes`, async ({ page }) => {
    const writes = await mockCutover(page, { contextStatus: status }); await page.goto("/imports/cutover");
    await expect(page.locator("main.cutover-page").getByRole("alert")).toContainText(message); await expect(page.locator("main.cutover-page form")).toHaveCount(0);
    await expect(page.locator("main.cutover-page")).not.toContainText("PRIVATE_SYNTHETIC_CONTEXT_DETAIL"); expect(writes).toHaveLength(0);
  });
}

test("uncertain manual catchup retains its exact key and never starts an automatic second block", async ({ page }) => {
  const initial = fixture({ effectsApplied: false, effects: [], capabilities: { ...fixture().capabilities!, canConsume: true, canCompensate: false }, catchup: { total: 0, created: 0, linkedBaseline: 0, review: 0, pending: 1, complete: false } });
  const writes = await mockCutover(page, { initial, onWrite: async (route, write) => { expect(write.path).toBe(`${manifestPath}/consume`); await route.fulfill({ status: 503, json: { code: "PRIVATE_UNACKNOWLEDGED_WRITE_DETAIL" } }); } });
  await page.goto(`/imports/cutover?manifest=${ids.manifest}`);
  const submit = page.getByRole("button", { name: "Traiter ce bloc de rattrapage", exact: true }); await expect(submit).toBeDisabled(); expect(writes).toHaveLength(0);
  const limit = page.getByLabel("Soumissions maximum pour ce clic"); await limit.fill("26"); await page.getByRole("checkbox", { name: /J’autorise uniquement ce bloc borné/u }).check(); await expect(submit).toBeDisabled();
  await limit.fill("1"); await expect(page.getByRole("checkbox", { name: /J’autorise uniquement ce bloc borné/u })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /J’autorise uniquement ce bloc borné/u }).check(); await submit.click();
  await expect(page.locator("main.cutover-page").getByRole("alert")).toContainText("Le serveur n’a pas confirmé le résultat"); expect(writes).toHaveLength(1);
  await expect(page.locator("main.cutover-page")).not.toContainText("PRIVATE_UNACKNOWLEDGED_WRITE_DETAIL");
  await submit.click(); await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual(writes[1]); expect(writes[0]?.body).toMatchObject({ expectedVersion: 4, limit: 1, confirmed: true });
  expect(writes.every((write) => write.path.endsWith("/consume"))).toBe(true);
});

test("manual catchup success rereads one receipt and resets confirmation, without activating Sheets", async ({ page }) => {
  const initial = fixture({ effectsApplied: false, effects: [], capabilities: { ...fixture().capabilities!, canConsume: true, canCompensate: false }, catchup: { total: 0, created: 0, linkedBaseline: 0, review: 0, pending: 1, complete: false } });
  const writes = await mockCutover(page, { initial, onWrite: async (route, write, setManifest) => { expect(write.path).toBe(`${manifestPath}/consume`); const after = fixture({ version: 5, capabilities: { ...fixture().capabilities!, canConsume: true } }); setManifest(after); await route.fulfill({ status: 201, json: { ...after, processed: 1 } }); } });
  await page.goto(`/imports/cutover?manifest=${ids.manifest}`); await page.getByLabel("Soumissions maximum pour ce clic").fill("1");
  await page.getByRole("checkbox", { name: /J’autorise uniquement ce bloc borné/u }).check(); await page.getByRole("button", { name: "Traiter ce bloc de rattrapage", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Reçu ${effect.id}`, exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /J’autorise uniquement ce bloc borné/u })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Traiter ce bloc de rattrapage", exact: true })).toBeDisabled(); expect(writes).toHaveLength(1);
  await page.reload(); await expect(page.getByRole("heading", { name: `Reçu ${effect.id}`, exact: true })).toBeVisible(); expect(writes).toHaveLength(1);
});

for (const status of ["REQUESTED", "BLOCKED_DOWNSTREAM"] as const) {
  test(`compensation ${status} is a persisted request or refusal, never a removed Lead`, async ({ page }) => {
    const reason = "Recette synthétique de préservation des écritures ultérieures";
    const writes = await mockCutover(page, { onWrite: async (route, write, setManifest) => { expect(write.path).toBe(`${manifestPath}/compensate`); expect(write.body).toMatchObject({ expectedVersion: 4, sourceKey: effect.sourceKey, confirmed: true, reason }); const after = fixture({ state: "SUSPENDED", version: 5, suspensionReason: "Demande de compensation à examiner", capabilities: { ...fixture().capabilities!, canCompensate: false, canObserve: false, canReconcile: false, canResume: true }, effects: [{ ...effect, compensationStatus: status, compensationReason: reason }] }); setManifest(after); await route.fulfill({ status: 201, json: { ...after, compensation: { sourceKey: effect.sourceKey, status, applied: false } } }); } });
    await page.setViewportSize({ width: 390, height: 1000 }); await page.goto(`/imports/cutover?manifest=${ids.manifest}`);
    const submit = page.getByRole("button", { name: "Consigner la demande et suspendre", exact: true }); await expect(submit).toBeDisabled();
    await page.getByLabel("Motif de demande de compensation").fill(reason); await expect(submit).toBeDisabled();
    await page.getByRole("checkbox", { name: /Je demande l’examen d’une compensation/u }).check(); await submit.click();
    await expect(page.getByText(status === "REQUESTED" ? "Demande de compensation enregistrée ; aucune compensation n’est appliquée." : "Compensation refusée : des écritures ultérieures empêchent un retour automatique sûr.", { exact: true })).toBeVisible();
    await expect(page.getByText(/Le Lead et son historique sont conservés/u)).toBeVisible(); await expect(page.getByRole("link", { name: "Ouvrir la fiche autorisée", exact: true })).toHaveAttribute("href", `/leads/${ids.lead}`);
    await expect(submit).toHaveCount(0); await page.reload(); await expect(page.getByText(/Le Lead et son historique sont conservés/u)).toBeVisible();
    await assertContained(page, 390); expect(writes).toHaveLength(1); expect(writes[0]?.path).toBe(`${manifestPath}/compensate`);
  });
}

test("stale binding and server-denied capabilities retain a readable journal without mutation controls", async ({ page }) => {
  const writes = await mockCutover(page, { initial: fixture({ bindingValid: false }) }); await page.goto(`/imports/cutover?manifest=${ids.manifest}`);
  await expect(page.getByText(/La source ou le lot lié a évolué/u)).toBeVisible(); await expect(page.getByRole("heading", { name: `Reçu ${effect.id}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Observer la source désactivée", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Consigner la demande et suspendre", exact: true })).toHaveCount(0); expect(writes).toHaveLength(0);
});
