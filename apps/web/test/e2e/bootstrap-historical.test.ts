import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { syntheticHistoricalParts, syntheticZip } from "../../../api/test/fixtures/import/historical-workbook.synthetic.js";
import { bootstrapFields, bootstrapSheets, type BootstrapPackage, type BootstrapReport, type BootstrapRows, type BootstrapSheetMapping, type HistoricalNote } from "../../app/imports/bootstrap/bootstrap-client.js";

interface PrivateFixture {
  account: { email: string; password: string };
  adviser: { id: string };
  campus: { id: string; code: string };
  program: { code: string };
  campaign: { code: string };
}
async function serverRead<T>(page: Page, route: string): Promise<T> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`Real BFF reread refused (${response.status})`);
    return await response.json() as T;
  }, route);
}

test.use({ trace: "off", video: "off", screenshot: "off" });

test("historical bootstrap persists through the real browser/BFF/API and resumes the same receipt", async ({ page, baseURL }) => {
  test.skip(process.env.CRM_BOOTSTRAP_BROWSER_TEST !== "true", "Requires the preserved, isolated CRMY-61 synthetic PostgreSQL/API fixture.");
  test.setTimeout(120_000);
  expect(process.env.CRM_LOCAL_E2E).toBe("true");
  const origin = new URL(baseURL ?? "");
  expect(["localhost", "127.0.0.1"]).toContain(origin.hostname);
  const privatePath = process.env.CRM_BOOTSTRAP_PROOF_CONFIG;
  const proofDirectory = process.env.CRM_BOOTSTRAP_PROOF_DIR;
  expect(privatePath).toBeTruthy(); expect(proofDirectory).toBeTruthy();
  const fixture = JSON.parse(await readFile(privatePath ?? "", "utf8")) as PrivateFixture;
  expect(fixture.account.email).toMatch(/@example\.invalid$/u); expect(fixture.account.password.length).toBeGreaterThanOrEqual(14);
  expect(fixture.campus.code).toMatch(/^SYNTHETIC/u);
  await mkdir(proofDirectory ?? "", { recursive: true });
  const buildId = (await readFile(path.resolve(".next/BUILD_ID"), "utf8")).trim();
  expect(buildId.length).toBeGreaterThan(5);
  const frontendDirectory = path.resolve("app/imports/bootstrap");
  const sourceHashes = Object.fromEntries(await Promise.all((await readdir(frontendDirectory)).filter((name) => /\.(?:tsx?|css)$/u.test(name)).sort().map(async (name) => [name, createHash("sha256").update(await readFile(path.join(frontendDirectory, name))).digest("hex")] as const))) as Record<string, string>;
  const marker = randomUUID().replaceAll("-", "");
  const parts = syntheticHistoricalParts();
  const firstSheet = parts.find(([name]) => name === "xl/worksheets/sheet1.xml");
  if (!firstSheet) throw new Error("Synthetic first sheet missing");
  firstSheet[1] = firstSheet[1]
    .replace('<c r="D9" t="inlineStr"><is><t>Bac</t></is></c>', "")
    .replace('<c r="E9" t="inlineStr"><is><t>PROGRAM_SYNTHETIC</t></is></c>', "")
    .replace('</row>', '<c r="K6" t="inlineStr"><is><t>COMMENTAIRE VIDE SOURCE</t></is></c></row>')
    .replace('</row></sheetData>', '<c r="K9" t="inlineStr"><is><t xml:space="preserve"> \n\t </t></is></c></row></sheetData>');
  expect(firstSheet[1]).not.toContain('r="D9"');
  expect(firstSheet[1]).not.toContain('r="E9"');
  expect(firstSheet[1]).toContain('r="K9"');
  for (const entry of parts) entry[1] = entry[1].replaceAll("PROGRAM_SYNTHETIC", fixture.program.code).replaceAll("synthetic@example.invalid", `browser-${marker}@example.invalid`);
  const workbook = syntheticZip(parts);
  const chunks: Array<{ decodedBytes: number; envelopeBytes: number }> = [];
  let confirmBody: string | undefined;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const body = request.postData();
    if (request.url().endsWith("/chunks") && body) {
      const parsed = JSON.parse(body) as { contentBase64: string };
      chunks.push({ decodedBytes: Buffer.from(parsed.contentBase64, "base64").length, envelopeBytes: Buffer.byteLength(body) });
    }
    if (request.url().endsWith("/confirm")) confirmBody = body ?? undefined;
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByLabel("Email professionnel").fill(fixture.account.email);
  await page.locator('input[name="password"]').fill(fixture.account.password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/leads$/u);
  await page.goto("/imports/bootstrap");
  await page.getByLabel("Campus cible autorisé").selectOption(fixture.campus.id);
  await page.getByLabel("Classeur XLSX figé").setInputFiles({ name: `browser-synthetic-${marker}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
  await page.getByRole("checkbox", { name: /Je confirme que le fichier/u }).check();
  await page.getByRole("button", { name: "Transférer par blocs et sceller", exact: true }).click();
  await expect(page.getByText("Le fichier a été scellé et relu depuis le serveur. Aucun dossier n’est encore importé.", { exact: true })).toBeVisible();
  const packageId = new URL(page.url()).searchParams.get("package");
  expect(packageId).toMatch(/^[a-f0-9-]{36}$/u);
  const prefix = `/api/crm/lead-import/bootstrap/packages/${packageId ?? ""}`;
  const sealed = await serverRead<BootstrapPackage>(page, prefix);
  expect(sealed.state).toBe("SEALED"); expect(sealed.counts.accepted).toBe(0);
  expect(chunks.length).toBeGreaterThan(0);
  for (const chunk of chunks) { expect(chunk.decodedBytes).toBeLessThanOrEqual(48 * 1024); expect(chunk.envelopeBytes).toBeLessThan(100 * 1024); }

  const fields: BootstrapSheetMapping["fields"] = { lastName: "A", firstName: "B", email: "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H", temperature: "J" };
  for (const name of bootstrapSheets) {
    const section = page.locator("details.bootstrap-mapping").filter({ has: page.locator("summary", { hasText: name }) });
    await expect(section).toHaveCount(1);
    await section.evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    await section.getByLabel("Regroupement de campagne existant").selectOption(fixture.campaign.code);
    for (const [field, label] of bootstrapFields) if (fields[field]) await section.getByRole("combobox", { name: label, exact: true }).selectOption(fields[field] ?? "");
    await section.getByRole("checkbox", { name: /^I ·/u }).check();
    if (name === "VISITES ET APPELS") await section.getByRole("checkbox", { name: /^K ·/u }).check();
    await section.getByLabel("Alias exact du fichier").fill("Conseiller synthétique");
    await section.getByRole("combobox", { name: "Compte CRM", exact: true }).selectOption(fixture.adviser.id);
    await section.getByRole("button", { name: "Ajouter l’alias", exact: true }).click();
  }
  await page.getByRole("button", { name: "Enregistrer le mapping R8 et analyser", exact: true }).click();
  await expect(page.getByText("Le mapping et les lignes de revue sont persistés puis relus. Cette analyse n’est pas une importation.", { exact: true })).toBeVisible();
  const preview = await serverRead<BootstrapPackage>(page, prefix);
  expect(preview.counts.total).toBe(4); expect(preview.counts.review).toBe(4); expect(preview.counts.accepted).toBe(0);
  const first = page.locator("article.bootstrap-row").filter({ has: page.getByRole("heading", { name: "VISITES ET APPELS · ligne 9", exact: true }) });
  await expect(first.getByText("Informations explicitement inconnues · avertissements serveur", { exact: true })).toBeVisible();
  await expect(first.getByText(/Formation d’origine non renseignée : reprise possible comme information inconnue/u)).toBeVisible();
  await expect(first.getByText(/Niveau d’origine non renseigné : reprise possible comme information inconnue/u)).toBeVisible();
  await expect(first.getByLabel("Formation validée")).toHaveValue("");
  await expect(first.getByLabel("Niveau validé")).toHaveValue("");
  await first.getByLabel("Correction explicite du prénom").fill("Reprise synthétique corrigée");
  await first.getByLabel("Justification conservée avec la décision").fill("Dossier synthétique distinct, prénom corrigé et provenance vérifiée");
  await first.getByRole("button", { name: "Enregistrer la décision, sans exécuter l’import", exact: true }).click();
  await expect(page.getByText("Décision enregistrée et relue. L’exécution du lot reste une action distincte.", { exact: true })).toBeVisible();
  const decidedRows = await serverRead<BootstrapRows>(page, `${prefix}/rows?limit=25`);
  const decided = decidedRows.items.find((row) => row.state === "READY");
  expect(decided?.decision?.resolvedValues?.firstName).toBe("Reprise synthétique corrigée");
  expect(decided?.values.firstName).toBe("Exemple");
  expect(decided?.decision?.resolvedValues?.ownerId).toBe(fixture.adviser.id);
  expect(decided?.decision?.resolvedValues?.program).toBe("");
  expect(decided?.decision?.resolvedValues?.educationLevel).toBe("");
  const pending = await serverRead<BootstrapPackage>(page, prefix);
  expect(pending.counts.pending).toBe(1); expect(pending.counts.accepted).toBe(0);

  const dimensions: Array<{ width: number; documentWidth: number; viewportWidth: number }> = [];
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await first.scrollIntoViewIfNeeded();
    const measure = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth }));
    expect(measure.documentWidth).toBeLessThanOrEqual(measure.viewportWidth + 1);
    dimensions.push({ width, ...measure });
    await page.screenshot({ path: path.join(proofDirectory ?? "", `bootstrap-ready-${width}.png`), fullPage: false });
  }
  await page.getByRole("checkbox", { name: /J’ai examiné le mapping/u }).check();
  await page.getByRole("button", { name: "Exécuter les décisions admissibles", exact: true }).click();
  await expect(page.getByText(/Le résultat et les reçus sont relus depuis PostgreSQL/u)).toBeVisible();
  await expect(page.getByText("Reçu d’import acquis", { exact: true })).toHaveCount(1);
  const report = await serverRead<BootstrapReport>(page, `${prefix}/report`);
  expect(report.package.counts.accepted).toBe(1); expect(report.package.counts.pending).toBe(0); expect(report.package.counts.review).toBe(3);
  expect(report.cutoverBlocked).toBe(true);
  expect(confirmBody).toBeTruthy();
  const replay = await page.evaluate(async ({ target, body }) => {
    const response = await fetch(target, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body });
    const result: unknown = await response.json(); return { status: response.status, replayed: !!result && typeof result === "object" && "replayed" in result && result.replayed === true };
  }, { target: `${prefix}/confirm`, body: confirmBody ?? "" });
  expect(replay.status).toBe(201); expect(replay.replayed).toBe(true);
  await page.reload();
  await expect(page.getByText("Reçu d’import acquis", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Exécuter les décisions admissibles", exact: true })).toBeDisabled();
  const resumed = await serverRead<BootstrapReport>(page, `${prefix}/report`);
  expect(resumed.package.id).toBe(packageId); expect(resumed.package.counts).toEqual(report.package.counts);
  await page.screenshot({ path: path.join(proofDirectory ?? "", "bootstrap-receipt-390.png"), fullPage: false });
  const acceptedRows = await serverRead<BootstrapRows>(page, `${prefix}/rows?limit=25`);
  const acceptedLeadId = acceptedRows.items.find((row) => row.state === "ACCEPTED")?.leadId;
  expect(acceptedLeadId).toMatch(/^[a-f0-9-]{36}$/u);
  const persistedLead = await serverRead<{ program: string; educationLevel: string; acquisitionKind: string }>(page, `/api/crm/leads/${acceptedLeadId ?? ""}`);
  expect(persistedLead.program).toBe(""); expect(persistedLead.educationLevel).toBe(""); expect(persistedLead.acquisitionKind).toBe("BASELINE");
  const historical = await serverRead<{ items: HistoricalNote[]; preservedNonInteractionBlankRecords?: number }>(page, `/api/crm/lead-import/bootstrap/leads/${acceptedLeadId ?? ""}/notes`);
  expect(historical.items).toHaveLength(1);
  expect(historical.items[0]?.text).toBe("Note exacte\navec accents é & espaces  ");
  expect(historical.items[0]?.author).toBeNull(); expect(historical.items[0]?.occurredAt).toBeNull();
  expect(historical.preservedNonInteractionBlankRecords ?? 0).toBe(0);
  await page.goto(`/leads/${acceptedLeadId ?? ""}`);
  await page.locator("summary").filter({ hasText: "Commentaires de reprise historique · provenance distincte" }).click();
  await expect(page.locator("#historical-notes-title")).toBeVisible();
  await expect(page.locator("#historical-notes-title").locator("..").locator("article").filter({ has: page.getByRole("heading", { name: "Commentaire importé · date et auteur source inconnus", exact: true }) })).toHaveCount(1);
  await expect(page.getByText("date et auteur source inconnus", { exact: false })).toBeVisible();
  await writeFile(path.join(proofDirectory ?? "", "browser-proof.json"), JSON.stringify({ kind: "REAL_BROWSER_BFF_API_SYNTHETIC", preCommit: true, sourceSha: process.env.CRM_PROOF_SOURCE_SHA ?? "pre-commit worktree", buildId, sourceHashes, packageId, fileSha256: sealed.sha256, chunks, dimensions, accepted: resumed.package.counts.accepted, remainingReview: resumed.package.counts.review, replayStatus: replay.status, replayed: replay.replayed, baselineUnknownProgramAndEducationPersisted: true, nonBlankHistoricalNotes: historical.items.length, whitespaceOnlySourceCellNotImportedAsInteraction: true, sourceCoverage: resumed.sourceCoverage, cutoverBlocked: resumed.cutoverBlocked, productionImportPerformed: false, personalVisualAcceptance: false }, null, 2));
});
