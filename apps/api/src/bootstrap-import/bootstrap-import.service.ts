import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type BootstrapImportPackage, type BootstrapImportRow } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext, type PermissionIdentity } from "../permissions/dynamic-context.js";
import { assertCutoverRuntimeAuthority, runtimeDenied, type CutoverDelegation } from "../cutover/cutover-runtime-authority.js";
import { canonicalCampus, leadResource } from "../permissions/dynamic-resources.js";
import { assignmentCandidateCapability, evaluatePermission, scheduledCutoverCapability, type EvaluationContext } from "../permissions/dynamic-evaluator.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../permissions/dynamic-repository.js";
import { resolveReference, validateLeadReferences } from "../references/reference.repository.js";
import { parseHistoricalWorkbook, type HistoricalAnnotation } from "./historical-workbook.js";
import { historicalStatusResolutionReason, normalizeHistoricalEmail, normalizeHistoricalPhone, requireExplicitHistoricalStatus, requireNoHistoricalContactCollision } from "./bootstrap-create-guards.js";
import { historicalReconciliation } from "./historical-reconciliation.js";
import { baselineOptionalValues, BASELINE_OPTIONAL_INFORMATION } from "./baseline-unknown-fields.js";
import { assertMapping, bytesHash, CHUNK_BYTES, decodeChunk, hash, HISTORICAL_SHEETS, IMPORT_FIELDS, KEY, MAX_PACKAGE_BYTES, refuse, SHA, UUID,
  record, COLUMN, type BootstrapChunkInput, type BootstrapConfirmInput, type BootstrapReopenInput, type CreateBootstrapInput, type HistoricalDecisionInput, type HistoricalMappingInput, type HistoricalSheetMapping, type HistoricalCycle } from "./bootstrap-import.contract.js";

type Cell = { value: string | number | boolean | null; raw: string | null; type: string; formula?: { text: string; attributes: Record<string, string> }; style?: string };
type Annotation = HistoricalAnnotation;
type SourceRow = { rowNumber: number; cells: Record<string, Cell>; annotations?: Annotation[]; date1904?: boolean };
type SnapshotSheet = { name: string; relationId: string; rows: SourceRow[]; columns: Array<{ letter: string; name: string }>; annotations?: Annotation[] };
type Snapshot = { sheets: SnapshotSheet[]; formulaCount: number; workbookProperties?: { date1904: boolean } };
type Values = Record<string, string | null>;
type MappedRow = { values: Values; comments: Array<{ column: string; text: string }>; sourceOwner: string | null; replacementOwner: string | null; rawStatus: string | null; originalSource: string | null; reasons: string[]; receivedDateEvidence?: { column: string; reference: string; cell: Cell; date1904: boolean } };
type SourceCoverage = { name: string; sourceCandidates: number; sourceRows: number; ledgerRows: number; literalCells: number; commentCells: number; formulaCells: number; nativeAnnotations: number; unmappedCells: number; excludedCells: number; quarantinedAnnotations: number };
const statuses = ["PROSPECT", "CONTACTED", "QUALIFIED", "ENROLLED", "CLOSED_LOST"];
const sources = ["OTHER", "WEBSITE", "WEB_FORM", "PHONE_CALL", "PHYSICAL_VISIT", "REFERRAL", "SOCIAL_MEDIA", "FACEBOOK", "INSTAGRAM", "GOOGLE", "PARTNER", "EVENT", "YNOV_COM", "YNOV_MA_LEGACY", "JOBINTECH", "LEGACY_RELAUNCH"];
const educationLevels = ["Bac", "Bac+1", "Bac+2", "Bac+3", "Bac+4", "Bac+5", "B1", "B2", "B3", "M1", "M2", "Terminale"];
const overrideFields = ["firstName", "lastName", "email", "phone", "program", "educationLevel", "source", "status", "temperature", "ownerId", "campaign"];
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = <T>(value: unknown): T => value as T;
function text(cell: Cell | undefined): string | null { return cell?.value === undefined || cell.value === null ? null : String(cell.value); }
function normalized(value: string): string { return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr"); }
const statusMap: Record<string, string> = { "a contacter": "PROSPECT", "injoignable": "PROSPECT", "injoignable / a relancer": "PROSPECT", "a relancer": "PROSPECT", "contacte": "CONTACTED", "inscrit": "ENROLLED", "sans suite": "CLOSED_LOST" };

/** Historical cells are never evaluated. A cached formula is evidence, not an
 * established business fact. Ownership resolves S before R, without fallback. */
export function mapHistoricalRow(row: SourceRow, mapping: HistoricalSheetMapping): MappedRow {
  const values: Values = { campaign: mapping.campaign };
  const reasons: string[] = [];
  for (const key of IMPORT_FIELDS) {
    const column = mapping.fields[key]; const cell = column ? row.cells[column] : undefined;
    values[key] = text(cell);
    if (cell?.formula && key !== "receivedDate") reasons.push(`FORMULA_REVIEW:${key}`); // Civil date is source metadata only, never a Lead business date.
  }
  const sourceOwner = values.owner ?? null; const replacementOwner = values.replacementOwner ?? null;
  const originalSource = values.source ?? null;
  const sourceAliases: Record<string, string> = { "appel entrant": "PHONE_CALL", appel: "PHONE_CALL", telephone: "PHONE_CALL", visite: "PHYSICAL_VISIT", recommandation: "REFERRAL", formulaire: "WEB_FORM", facebook: "SOCIAL_MEDIA", instagram: "SOCIAL_MEDIA", google: "WEBSITE", "ynov.com": "YNOV_COM", "ynov.ma": "YNOV_MA_LEGACY", jobintech: "JOBINTECH" };
  values.source = originalSource?.trim() ? sourceAliases[normalized(originalSource)] ?? (sources.includes(originalSource.trim().toUpperCase()) ? originalSource.trim().toUpperCase() : null) : null;
  if (originalSource?.trim() && !values.source) reasons.push("SOURCE_UNKNOWN");
  const selected = replacementOwner?.trim() ? replacementOwner : sourceOwner;
  values.ownerId = selected?.trim() && Object.hasOwn(mapping.ownerAliases, selected.trim()) ? mapping.ownerAliases[selected.trim()]! : null;
  if (selected?.trim() && !values.ownerId) reasons.push("OWNER_UNKNOWN");
  if (!selected?.trim()) reasons.push("OWNER_MISSING");
  const rawStatus = values.status ?? null;
  values.status = rawStatus?.trim() ? statusMap[normalized(rawStatus)] ?? null : null;
  const statusResolution = historicalStatusResolutionReason(rawStatus);
  if (statusResolution) reasons.push(statusResolution);
  else if (!values.status) reasons.push("STATUS_UNKNOWN");
  if (rawStatus && normalized(rawStatus) === "doublon") reasons.push("HISTORICAL_DUPLICATE_STATUS_REVIEW");
  if (["ENROLLED", "CLOSED_LOST"].includes(values.status ?? "")) reasons.push("HISTORICAL_TERMINAL_STATUS_REVIEW");
  const rawTemperature = values.temperature?.trim() ? normalized(values.temperature) : "";
  values.temperature = ({ froid: "COLD", cold: "COLD", tiede: "WARM", warm: "WARM", chaud: "HOT", hot: "HOT" } as Record<string, string>)[rawTemperature] ?? (rawTemperature ? null : "UNEVALUATED");
  if (rawTemperature && !values.temperature) reasons.push("TEMPERATURE_UNKNOWN");
  for (const key of ["firstName", "lastName", "source"]) if (!values[key]?.trim()) reasons.push(`REQUIRED_MAPPING_MISSING:${key}`);
  for (const key of BASELINE_OPTIONAL_INFORMATION) if (!values[key]?.trim() && !reasons.includes(`FORMULA_REVIEW:${key}`)) { values[key] = ""; reasons.push(`BASELINE_INFORMATION_UNKNOWN:${key}`); }
  if (!values.email?.trim() && !values.phone?.trim()) reasons.push("CONTACT_IDENTITY_MISSING");
  const comments = mapping.commentColumns.flatMap((column) => {
    const cell = row.cells[column]; const value = text(cell);
    if (cell?.formula) reasons.push(`FORMULA_REVIEW:comment:${column}`);
    return value === null || value.trim().length === 0 ? [] : [{ column, text: value }];
  });
  const dateColumn = mapping.fields.receivedDate; const dateCell = dateColumn ? row.cells[dateColumn] : undefined;
  return { values, comments, sourceOwner, replacementOwner, rawStatus, originalSource, reasons: [...new Set(reasons)], ...(dateColumn && dateCell ? { receivedDateEvidence: { column: dateColumn, reference: `${dateColumn}${row.rowNumber}`, cell: dateCell, date1904: row.date1904 ?? false } } : {}) };
}

function sourceRows(sheet: SnapshotSheet): SourceRow[] {
  const rows = new Map(sheet.rows.map((row) => [row.rowNumber, { ...row, annotations: [] as Annotation[] }]));
  for (const annotation of sheet.annotations ?? []) {
    const match = /^([A-Z]{1,2})([1-9]\d*)$/.exec(annotation.reference); if (!match) refuse("bootstrap_annotation_coordinate_invalid");
    const rowNumber = Number(match[2]); if (rowNumber <= 6 || rowNumber > 50000) refuse("bootstrap_annotation_row_review_required");
    if (!rows.has(rowNumber)) rows.set(rowNumber, { rowNumber, cells: {}, annotations: [] });
    rows.get(rowNumber)!.annotations.push(annotation);
    if (rows.get(rowNumber)!.annotations.length > 100) refuse("bootstrap_row_annotation_limit");
  }
  return [...rows.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}
function identityColumns(sheet: SnapshotSheet): string[] {
  return sheet.columns.filter((column) => /^(?:nom|prenom|nom complet|nom et prenom|email|e-mail|mail|telephone|tel|gsm|portable|contact)(?:\s|$)/.test(normalized(column.name))).map((column) => column.letter);
}
export function historicalSourceCoverage(sheet: SnapshotSheet, mapping: HistoricalSheetMapping): SourceCoverage {
  const result: SourceCoverage = { name: sheet.name, sourceCandidates: 0, sourceRows: 0, ledgerRows: 0, literalCells: 0, commentCells: 0, formulaCells: 0, nativeAnnotations: sheet.annotations?.length ?? 0, unmappedCells: 0, excludedCells: 0, quarantinedAnnotations: sheet.annotations?.length ?? 0 };
  const covered = new Set([...Object.values(mapping.fields), ...mapping.commentColumns]); const excluded = new Set(mapping.excludedColumns?.map((item) => item.column)); const identities = identityColumns(sheet);
  for (const source of sourceRows(sheet)) {
    const mapped = mapHistoricalRow(source, mapping); const literal = Object.entries(source.cells).filter(([, cell]) => !cell.formula && text(cell) !== null && text(cell)!.length > 0);
    const candidate = identities.some((column) => text(source.cells[column])?.trim()) || ["firstName", "lastName", "email", "phone"].some((key) => mapped.values[key]?.trim());
    result.sourceRows++; if (candidate) result.sourceCandidates++;
    result.literalCells += literal.length; result.formulaCells += Object.values(source.cells).filter((cell) => cell.formula).length;
    const evidence = Object.entries(source.cells).filter(([, cell]) => cell.formula || (text(cell) !== null && text(cell)!.length > 0));
    result.commentCells += mapped.comments.length; result.unmappedCells += evidence.filter(([column]) => !covered.has(column) && !excluded.has(column)).length;
    result.excludedCells += evidence.filter(([column]) => excluded.has(column)).length;
    if (candidate || evidence.some(([column]) => !excluded.has(column)) || mapped.comments.length || source.annotations?.length) result.ledgerRows++;
  }
  return result;
}

/** All writes and their receipts share the repository's PostgreSQL permission
 * fence. Replay first revalidates the current session, grants and campus. */
@Injectable()
export class BootstrapImportService {
  constructor(@Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository) {}

  async context(actor: Principal): Promise<unknown> {
    return this.permissions.readTransaction(async (tx) => {
      const current = await currentPrincipal(tx, actor); const snapshots = await this.permissions.snapshots(tx);
      const references = await tx.crmReference.findMany({ where: { state: "ACTIVE", kind: { in: ["CAMPUS", "PROGRAM", "CAMPAIGN"] } }, orderBy: { label: "asc" } });
      const campuses = [];
      for (const ref of references.filter((row) => row.kind === "CAMPUS")) {
        const campus = await canonicalCampus(tx, ref.id); const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
        const can = (key: string): boolean => evaluatePermission(current, key, snapshots, context).allowed;
        if (can("import.view")) campuses.push({ id: ref.id, code: ref.code, label: ref.label, canUpload: can("import.execute"), canMap: can("import.execute"), canDecide: can("import.review.resolve"), canConfirm: can("import.confirm") });
      }
      if (!campuses.length) permissionDenied();
      const ids = campuses.map((row) => row.id);
      const availablePrograms = await tx.crmProgramAvailability.findMany({ where: { campusId: { in: ids }, active: true }, select: { campusId: true, programId: true } });
      const owners = await tx.collaborator.findMany({ where: { active: true, firstLoginRequired: false, campusId: { in: ids } }, select: { id: true, professionalDisplayName: true, campusId: true, roles: true } });
      const eligible = owners.filter((owner) => assignmentCandidateCapability(owner.roles as Principal["roles"], snapshots, { campus: owner.campusId!, active: true, own: true, team: false, campusAllowed: true, globalAllowed: false }));
      return { campuses, owners: eligible.map((owner) => ({ id: owner.id, label: owner.professionalDisplayName?.trim() || owner.id, campusId: owner.campusId })),
        programs: availablePrograms.flatMap((availability) => { const ref = references.find((item) => item.id === availability.programId && item.kind === "PROGRAM" && (!item.campusId || item.campusId === availability.campusId)); return ref ? [{ code: ref.code, label: ref.label, campusId: availability.campusId }] : []; }),
        campaigns: references.filter((ref) => ref.kind === "CAMPAIGN" && (!ref.campusId || ids.includes(ref.campusId))).map((ref) => ({ code: ref.code, label: ref.label, campusId: ref.campusId })),
        educationLevels, sources, statuses, canUpload: campuses.some((row) => row.canUpload), canMap: campuses.some((row) => row.canMap), canDecide: campuses.some((row) => row.canDecide), canConfirm: campuses.some((row) => row.canConfirm) };
    });
  }

  async create(input: CreateBootstrapInput, actor: Principal): Promise<unknown> {
    if (!input || typeof input.fileName !== "string" || input.fileName.includes("\0") || !/^[^\\/:]{1,175}\.xlsx$/i.test(input.fileName) || !Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_PACKAGE_BYTES || !SHA.test(input.sha256) || !UUID.test(input.campusId) || !KEY.test(input.idempotencyKey)) refuse("bootstrap_package_invalid");
    return this.permissions.transaction(async (tx) => {
      await this.authorize(tx, actor, input.campusId, ["import.execute", "import.view"]);
      const fingerprint = hash(input); const previous = await tx.bootstrapImportPackage.findUnique({ where: { actorId_key: { actorId: actor.userId, key: input.idempotencyKey } } });
      if (previous) { if (previous.fingerprint !== fingerprint) this.conflict("bootstrap_package_key_conflict"); return { ...await this.view(tx, previous), replayed: true }; }
      const snapshot = await tx.bootstrapImportPackage.findUnique({ where: { sha256: input.sha256 } });
      if (snapshot) { if (snapshot.campusId !== input.campusId || snapshot.sizeBytes !== input.sizeBytes) this.conflict("bootstrap_snapshot_already_bound"); return { ...await this.view(tx, snapshot), replayed: true }; }
      const row = await tx.bootstrapImportPackage.create({ data: { actorId: actor.userId, campusId: input.campusId, key: input.idempotencyKey, fingerprint, fileName: input.fileName, sizeBytes: input.sizeBytes, sha256: input.sha256 } });
      return this.view(tx, row);
    });
  }

  async chunk(id: string, input: BootstrapChunkInput, actor: Principal): Promise<unknown> {
    const bytes = decodeChunk(input);
    return this.permissions.transaction(async (tx) => {
      const row = await this.package(tx, id, actor, ["import.execute", "import.view"]);
      const expectedChunks = Math.ceil(row.sizeBytes / CHUNK_BYTES); const expectedBytes = input.index === expectedChunks - 1 ? row.sizeBytes - input.index * CHUNK_BYTES : CHUNK_BYTES;
      if (input.index >= expectedChunks || bytes.length !== expectedBytes) refuse("bootstrap_chunk_size_invalid");
      const previous = await tx.bootstrapImportChunk.findUnique({ where: { packageId_index: { packageId: id, index: input.index } } });
      if (previous) { if (previous.sha256 !== input.sha256 || !Buffer.from(previous.bytes).equals(bytes)) this.conflict("bootstrap_chunk_conflict"); return { ...await this.view(tx, row), replayed: true }; }
      if (row.state !== "UPLOADING") this.conflict("bootstrap_snapshot_immutable");
      await tx.bootstrapImportChunk.create({ data: { packageId: id, index: input.index, sha256: input.sha256, bytes: Uint8Array.from(bytes) } });
      return this.view(tx, row);
    });
  }

  async seal(id: string, input: { sha256: string }, actor: Principal): Promise<unknown> {
    if (!input || !SHA.test(input.sha256)) refuse("bootstrap_seal_invalid");
    return this.permissions.transaction(async (tx) => {
      const row = await this.package(tx, id, actor, ["import.execute", "import.view"]);
      if (input.sha256 !== row.sha256) this.conflict("bootstrap_snapshot_hash_conflict");
      if (row.state !== "UPLOADING") return { ...await this.view(tx, row), replayed: true };
      const chunks = await tx.bootstrapImportChunk.findMany({ where: { packageId: id }, orderBy: { index: "asc" } });
      if (chunks.length !== Math.ceil(row.sizeBytes / CHUNK_BYTES) || chunks.some((chunk, index) => chunk.index !== index || bytesHash(chunk.bytes) !== chunk.sha256)) this.conflict("bootstrap_snapshot_incomplete");
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.bytes)));
      if (bytes.length !== row.sizeBytes || bytesHash(bytes) !== row.sha256) this.conflict("bootstrap_snapshot_integrity_invalid");
      const snapshot = parseHistoricalWorkbook(bytes);
      const sealed = await tx.bootstrapImportPackage.update({ where: { id, version: row.version }, data: { state: "SEALED", snapshot: json(snapshot), sealedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, actor, row, "BOOTSTRAP_SNAPSHOT_SEALED", `seal:${row.id}`, { sizeBytes: row.sizeBytes, sha256: row.sha256, sheets: HISTORICAL_SHEETS });
      return this.view(tx, sealed);
    });
  }

  async get(id: string, actor: Principal): Promise<unknown> { return this.permissions.readTransaction(async (tx) => this.view(tx, await this.package(tx, id, actor, ["import.view"]))); }

  async mapping(id: string, input: HistoricalMappingInput, actor: Principal): Promise<unknown> {
    assertMapping(input);
    return this.permissions.transaction(async (tx) => {
      const row = await this.package(tx, id, actor, ["import.execute", "import.view"]);
      const fingerprint = hash({ ...input, expectedVersion: undefined });
      const previous = await tx.bootstrapImportPlan.findFirst({ where: { packageId: id }, orderBy: { version: "desc" } });
      if (previous?.fingerprint === fingerprint) return { ...await this.view(tx, row), replayed: true };
      if (row.state !== "SEALED" || row.version !== input.expectedVersion || previous) this.conflict("bootstrap_mapping_conflict");
      const snapshot = object<Snapshot>(row.snapshot); if (!snapshot?.sheets) this.conflict("bootstrap_snapshot_missing");
      const batch = await tx.ingestionBatch.create({ data: { idempotencyKey: `bootstrap:${row.id}`, profile: "LEGACY_CRM_R8", assignmentMode: "HISTORICAL_EXPLICIT", actorId: actor.userId, fingerprint, totalCount: 0, createdCount: 0, attachedCount: 0, reviewCount: 0, invalidCount: 0 } });
      const coverage = snapshot.sheets.map((sheet) => historicalSourceCoverage(sheet, input.sheets.find((item) => item.name === sheet.name)!));
      const plan = await tx.bootstrapImportPlan.create({ data: { packageId: id, version: 1, mappingVersion: input.mappingVersion, fingerprint, configuration: json({ ...input, sourceCoverage: coverage }) } });
      let count = 0;
      const pendingRows: Prisma.BootstrapImportRowCreateManyInput[] = [];
      for (const sheet of snapshot.sheets) {
        const mapping = input.sheets.find((item) => item.name === sheet.name)!;
        const campus = await canonicalCampus(tx, row.campusId);
        const campaign = await resolveReference(tx, "CAMPAIGN", mapping.campaign, campus.id);
        if (campaign?.state !== "ACTIVE") throw new UnprocessableEntityException({ code: "REFERENCE_VALUE_UNKNOWN", field: "campaign" });
        const covered = new Set([...Object.values(mapping.fields), ...mapping.commentColumns]); const excluded = new Set(mapping.excludedColumns?.map((item) => item.column));
        for (const original of sourceRows(sheet)) {
          const source = { ...original, date1904: snapshot.workbookProperties?.date1904 ?? false };
          const mapped = mapHistoricalRow(source, mapping);
          const candidate = identityColumns(sheet).some((column) => text(source.cells[column])?.trim()) || ["firstName", "lastName", "email", "phone"].some((key) => mapped.values[key]?.trim());
          const evidence = Object.entries(source.cells).filter(([, cell]) => cell.formula || (text(cell) !== null && text(cell)!.length > 0));
          if (!candidate && !evidence.some(([column]) => !excluded.has(column)) && !mapped.comments.length && !source.annotations?.length) continue; // Only explicitly excluded decorations may omit a ledger row.
          if (++count > 10000) refuse("bootstrap_row_limit_exceeded");
          if (!candidate) mapped.reasons.push("ORPHAN_COMMENT_REVIEW");
          for (const [column] of evidence) if (!covered.has(column) && !excluded.has(column)) mapped.reasons.push(`UNMAPPED_SOURCE_CELL_REVIEW:${column}`);
          if (source.annotations?.length) mapped.reasons.push("NATIVE_ANNOTATION_QUARANTINE");
          if (new Set(source.annotations?.map((annotation) => annotation.reference)).size !== source.annotations?.length) mapped.reasons.push("ANNOTATION_SAME_CELL_AMBIGUITY");
          pendingRows.push({ packageId: id, planId: plan.id, sheet: sheet.name, relationId: sheet.relationId, rowNumber: source.rowNumber,
            sourceKey: hash([row.sha256, sheet.relationId, source.rowNumber]), fingerprint: hash(source), payload: json(source), mapped: json(mapped), reasons: mapped.reasons, state: "REVIEW" });
          if (pendingRows.length === 250) { await tx.bootstrapImportRow.createMany({ data: pendingRows }); pendingRows.length = 0; }
        }
      }
      if (pendingRows.length) await tx.bootstrapImportRow.createMany({ data: pendingRows });
      await tx.ingestionBatch.update({ where: { id: batch.id }, data: { totalCount: count, reviewCount: count } });
      const changed = await tx.bootstrapImportPackage.update({ where: { id, version: row.version }, data: { state: "MAPPED", batchId: batch.id, version: { increment: 1 } } });
      await this.audit(tx, actor, row, "BOOTSTRAP_MAPPING_SAVED", `mapping:${row.id}`, { planId: plan.id, fingerprint, total: count });
      return this.view(tx, changed);
    });
  }

  async rows(id: string, after: string | undefined, limit: number, actor: Principal): Promise<unknown> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (after && !UUID.test(after))) refuse("bootstrap_page_invalid");
    return this.permissions.readTransaction(async (tx) => {
      await this.package(tx, id, actor, ["import.view"]);
      if (after && !await tx.bootstrapImportRow.findFirst({ where: { id: after, packageId: id } })) refuse("bootstrap_cursor_invalid");
      const items = await tx.bootstrapImportRow.findMany({ where: { packageId: id }, orderBy: { id: "asc" }, take: limit + 1, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
      return { items: items.slice(0, limit).map((row) => this.rowView(row, actor)), nextAfter: items.length > limit ? items[limit - 1]!.id : null };
    });
  }

  async decide(id: string, rowId: string, input: HistoricalDecisionInput, actor: Principal): Promise<unknown> {
    if (!UUID.test(rowId) || !input || !KEY.test(input.idempotencyKey) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1
      || !["CREATE_DOSSIER", "LINK_EXISTING", "IGNORE"].includes(input.action) || typeof input.reason !== "string" || input.reason.trim().length < 8 || input.reason.length > 1000
      || (input.action === "LINK_EXISTING" ? !UUID.test(input.targetLeadId ?? "") : input.targetLeadId !== undefined)
      || Object.keys(input).some((key) => !["expectedVersion", "idempotencyKey", "action", "targetLeadId", "reason", "overrides", "cycle", "annotations"].includes(key))
      || (input.overrides !== undefined && (!record(input.overrides) || Object.entries(input.overrides).some(([key, value]) => !overrideFields.includes(key) || typeof value !== "string" || value.length > 254)))) refuse("bootstrap_decision_invalid");
    return this.permissions.transaction(async (tx) => {
      const packageRow = await this.package(tx, id, actor, ["import.review.resolve", "import.view"]);
      const row = await tx.bootstrapImportRow.findFirst({ where: { id: rowId, packageId: id } }); if (!row) this.notFound();
      if (await tx.bootstrapImportReceipt.findFirst({ where: { packageId: id, operation: "REOPEN_ROW", response: { path: ["previousDecisionKey"], equals: input.idempotencyKey } } })) this.conflict("bootstrap_superseded_decision_key");
      this.validateCycle(input.cycle, object<SourceRow>(row.payload));
      this.validateAnnotations(input, object<SourceRow>(row.payload));
      const fingerprint = hash({ ...input, actorId: actor.userId, expectedVersion: undefined });
      if (row.decisionKey === input.idempotencyKey) {
        if (row.decisionFingerprint !== fingerprint) this.conflict("bootstrap_decision_key_conflict");
        const saved = object<HistoricalDecisionInput & { values: Values }>(row.decision);
        if (saved.action === "CREATE_DOSSIER") await this.validateCreate(tx, actor, packageRow, row, saved.values, saved);
        else if (saved.action === "LINK_EXISTING") await this.authorizeLinkedLead(tx, actor, packageRow, saved.targetLeadId!);
        return { ...this.rowView(row, actor), replayed: true };
      }
      if (row.state !== "REVIEW" || row.version !== input.expectedVersion || row.decision) this.conflict("bootstrap_decision_conflict");
      const mapped = object<MappedRow>(row.mapped); const values = { ...mapped.values, ...input.overrides };
      if (input.action === "CREATE_DOSSIER") await this.validateCreate(tx, actor, packageRow, row, values, input);
      if (input.action === "LINK_EXISTING") {
        this.validateSourceCoverage(mapped, input, object<SourceRow>(row.payload));
        await this.authorizeLinkedLead(tx, actor, packageRow, input.targetLeadId!);
        if (mapped.reasons.some((reason) => reason.startsWith("FORMULA_REVIEW:comment:"))) throw new UnprocessableEntityException({ code: "bootstrap_formula_comment_review_required" });
      }
      const changed = await tx.bootstrapImportRow.update({ where: { id: rowId, version: row.version }, data: { decision: json({ ...input, actorId: actor.userId, values }), decisionKey: input.idempotencyKey,
        decisionFingerprint: fingerprint, version: { increment: 1 }, state: "READY" } });
      await this.audit(tx, actor, packageRow, "BOOTSTRAP_ROW_DECIDED", `decision:${hash([row.id, input.idempotencyKey, fingerprint])}`, { rowId, action: input.action, fingerprint, sourceKey: row.sourceKey });
      return this.rowView(changed, actor);
    });
  }

  async reopen(id: string, rowId: string, input: BootstrapReopenInput, actor: Principal): Promise<unknown> {
    if (!UUID.test(rowId) || !record(input) || Object.keys(input).some((key) => !["expectedVersion", "idempotencyKey", "reason"].includes(key))
      || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.idempotencyKey !== "string" || !KEY.test(input.idempotencyKey)
      || typeof input.reason !== "string" || input.reason.trim().length < 8 || input.reason.length > 1000) refuse("bootstrap_reopen_invalid");
    return this.permissions.transaction(async (tx) => {
      const packageRow = await this.package(tx, id, actor, ["import.review.resolve", "import.view"]);
      const row = await tx.bootstrapImportRow.findFirst({ where: { id: rowId, packageId: id } }); if (!row) this.notFound();
      if (row.fingerprint !== hash(row.payload)) this.conflict("bootstrap_source_integrity_conflict");
      if (row.leadId || ["ACCEPTED", "IGNORED"].includes(row.state) || await tx.bootstrapImportReceipt.findUnique({ where: { packageId_operation_key: { packageId: id, operation: "COMMIT_ROW", key: rowId } } })) this.conflict("bootstrap_committed_row_cannot_reopen");
      const fingerprint = hash({ ...input, rowId, actorId: actor.userId });
      const receipt = await tx.bootstrapImportReceipt.findUnique({ where: { packageId_operation_key: { packageId: id, operation: "REOPEN_ROW", key: input.idempotencyKey } } });
      const currentDecision = row.decision ? object<{ actorId: string }>(row.decision) : null;
      if (receipt) {
        const saved = object<{ rowId: string; previousDecision: { actorId: string }; reopenedVersion: number }>(receipt.response);
        if (receipt.actorId !== actor.userId || saved.previousDecision?.actorId !== actor.userId || (currentDecision && currentDecision.actorId !== actor.userId)) permissionDenied();
        if (receipt.fingerprint !== fingerprint || saved.rowId !== rowId) this.conflict("bootstrap_reopen_key_conflict");
        return { ...this.rowView(row, actor), replayed: true, reopenedVersion: saved.reopenedVersion };
      }
      if (currentDecision?.actorId !== actor.userId) permissionDenied();
      if (row.state !== "READY" || row.version !== input.expectedVersion || !row.decision || !row.decisionKey || !row.decisionFingerprint || input.idempotencyKey === row.decisionKey) this.conflict("bootstrap_reopen_conflict");
      const previousDecision = row.decision;
      if (row.decisionFingerprint !== hash({ ...object<Record<string, unknown>>(previousDecision), expectedVersion: undefined, values: undefined })) this.conflict("bootstrap_decision_integrity_conflict");
      const changed = await tx.bootstrapImportRow.update({ where: { id: rowId, version: row.version }, data: { state: "REVIEW", version: { increment: 1 }, decision: Prisma.DbNull, decisionKey: null, decisionFingerprint: null } });
      const response = { rowId, previousDecision, previousDecisionKey: row.decisionKey, previousDecisionFingerprint: row.decisionFingerprint, reopenedVersion: changed.version, reason: input.reason };
      await tx.bootstrapImportReceipt.create({ data: { packageId: id, operation: "REOPEN_ROW", key: input.idempotencyKey, actorId: actor.userId, fingerprint, response: json(response) } });
      await this.audit(tx, actor, packageRow, "BOOTSTRAP_ROW_REOPENED", `reopen:${hash([rowId, input.idempotencyKey])}`, response);
      return this.rowView(changed, actor);
    });
  }

  async confirm(id: string, input: BootstrapConfirmInput, actor: Principal): Promise<unknown> {
    if (!input || input.confirmed !== true || !KEY.test(input.idempotencyKey) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !Number.isInteger(input.limit ?? 25) || (input.limit ?? 25) < 1 || (input.limit ?? 25) > 25) refuse("bootstrap_confirmation_invalid");
    return this.permissions.transaction(async (tx) => {
      const row = await this.package(tx, id, actor, ["import.execute", "import.confirm", "import.review.resolve", "import.view"]); const fingerprint = hash(input);
      const receipt = await tx.bootstrapImportReceipt.findUnique({ where: { packageId_operation_key: { packageId: id, operation: "CONFIRM", key: input.idempotencyKey } } });
      if (receipt) {
        if (receipt.fingerprint !== fingerprint || receipt.actorId !== actor.userId) this.conflict("bootstrap_confirmation_key_conflict");
        const saved = object<{ result: Record<string, unknown>; rowIds: string[] }>(receipt.response);
        if (!saved.result || !Array.isArray(saved.rowIds)) this.conflict("bootstrap_receipt_integrity_invalid");
        const committed = await tx.bootstrapImportRow.findMany({ where: { packageId: id, id: { in: saved.rowIds } } });
        if (committed.length !== saved.rowIds.length) this.conflict("bootstrap_receipt_integrity_invalid");
        for (const source of committed) await this.revalidateDecision(tx, row, source, actor);
        return { ...saved.result, replayed: true };
      }
      if (!row.batchId || !["MAPPED", "PARTIAL"].includes(row.state) || row.version !== input.expectedVersion) this.conflict("bootstrap_confirmation_conflict");
      const ready = await tx.bootstrapImportRow.findMany({ where: { packageId: id, state: "READY", decision: { path: ["actorId"], equals: actor.userId } }, orderBy: { id: "asc" }, take: input.limit ?? 25 });
      if (!ready.length) this.conflict("bootstrap_no_owned_decided_rows");
      for (const source of ready) await this.commitRow(tx, row, source, actor);
      const counts = await this.counts(tx, id);
      await tx.ingestionBatch.update({ where: { id: row.batchId }, data: { createdCount: await tx.bootstrapImportRow.count({ where: { packageId: id, state: "ACCEPTED", decision: { path: ["action"], equals: "CREATE_DOSSIER" } } }),
        attachedCount: await tx.bootstrapImportRow.count({ where: { packageId: id, state: "ACCEPTED", decision: { path: ["action"], equals: "LINK_EXISTING" } } }), reviewCount: counts.review + counts.pending, invalidCount: counts.invalid } });
      const batchCounts = await tx.ingestionBatch.findUniqueOrThrow({ where: { id: row.batchId } });
      const reportValues = { mappingId: id, mappingVersion: 1, sourceFileSha256: row.sha256, totalCount: counts.total, createdCount: batchCounts.createdCount, updatedCount: 0, ignoredCount: counts.ignored,
        duplicateCount: batchCounts.attachedCount, errorCount: counts.review + counts.pending + counts.invalid };
      await tx.importReport.upsert({ where: { batchId: row.batchId }, create: { jobId: `bootstrap:${id}`, batchId: row.batchId, ...reportValues }, update: reportValues });
      const changed = await tx.bootstrapImportPackage.update({ where: { id, version: row.version }, data: { state: counts.review + counts.pending ? "PARTIAL" : "COMPLETED", version: { increment: 1 } } });
      const result = await this.view(tx, changed);
      await tx.bootstrapImportReceipt.create({ data: { packageId: id, operation: "CONFIRM", key: input.idempotencyKey, actorId: actor.userId, fingerprint, response: json({ result, rowIds: ready.map((item) => item.id) }) } });
      await this.audit(tx, actor, row, "BOOTSTRAP_CONFIRMATION_COMMITTED", `confirm:${row.id}:${input.idempotencyKey}`, { counts, rowIds: ready.map((item) => item.id) });
      return result;
    });
  }

  async report(id: string, actor: Principal): Promise<unknown> {
    return this.permissions.readTransaction(async (tx) => {
      const row = await this.package(tx, id, actor, ["import.view"]), principal = await currentPrincipal(tx, actor), snapshots = await this.permissions.snapshots(tx);
      return this.reportCore(tx, row, [principal], (identity, context) => evaluatePermission(principal, "lead.view", snapshots, context).allowed);
    });
  }
  /** Internal scheduled capability: no HTTP Principal/session is synthesized.
   * Both persisted delegates must see the current BASELINE targets. */
  async reportCutoverRuntime(tx: PermissionTransaction, id: string, delegation: CutoverDelegation, manifestId: string, assignment: boolean): Promise<unknown> {
    const row = await tx.bootstrapImportPackage.findUnique({ where: { id } });
    if (!row) this.notFound();
    const authority = await assertCutoverRuntimeAuthority(tx, this.permissions, delegation, row.campusId, manifestId, assignment);
    const report = await this.reportCore(tx, row, authority.identities, (identity, context) => scheduledCutoverCapability(identity.roles, "lead.view", authority.snapshots, context));
    // HTTP reports may legitimately omit current axes. A scheduled producer
    // must instead see every BASELINE target through BOTH current authorities.
    if (report.reconciliation.currentDossierAxes.withheld > 0) runtimeDenied();
    return report;
  }
  private async reportCore(tx: PermissionTransaction, row: BootstrapImportPackage, identities: PermissionIdentity[], visible: (identity: PermissionIdentity, context: EvaluationContext) => boolean): Promise<Record<string, unknown> & { reconciliation: ReturnType<typeof historicalReconciliation> }> {
      const id = row.id, items = await tx.bootstrapImportRow.groupBy({ by: ["sheet", "state"], where: { packageId: id }, _count: true });
      const bySheet = HISTORICAL_SHEETS.map((name) => {
        const count = (states: string[]): number => items.filter((item) => item.sheet === name && states.includes(item.state)).reduce((sum, item) => sum + item._count, 0);
        return { name, total: count(["ACCEPTED", "REVIEW", "READY", "INVALID", "IGNORED"]), accepted: count(["ACCEPTED"]), review: count(["REVIEW", "READY"]), invalid: count(["INVALID"]), ignored: count(["IGNORED"]) };
      });
      const plan = await tx.bootstrapImportPlan.findFirst({ where: { packageId: id }, orderBy: { version: "desc" } });
      const coverage = plan ? object<{ sourceCoverage?: SourceCoverage[] }>(plan.configuration).sourceCoverage : undefined;
      const ledgers = await tx.bootstrapImportRow.findMany({ where: { packageId: id }, select: { sheet: true, state: true, reasons: true, decision: true } });
      const effectiveCoverage = (coverage ?? []).map((sheet) => ({ ...sheet,
        remainingUnmappedCells: ledgers.filter((item) => item.sheet === sheet.name && item.state !== "IGNORED").reduce((total, item) => total + item.reasons.filter((reason) => reason.startsWith("UNMAPPED_SOURCE_CELL_REVIEW:")).length, 0),
        remainingQuarantinedAnnotations: ledgers.filter((item) => item.sheet === sheet.name && item.state !== "IGNORED" && item.reasons.includes("NATIVE_ANNOTATION_QUARANTINE") && !object<HistoricalDecisionInput | null>(item.decision)?.annotations?.length).length }));
      const complete = !!coverage && effectiveCoverage.every((sheet) => !sheet.remainingUnmappedCells && !sheet.remainingQuarantinedAnnotations) && coverage.reduce((total, sheet) => total + sheet.ledgerRows, 0) === bySheet.reduce((total, sheet) => total + sheet.total, 0);
      const reconciliationRows = await tx.bootstrapImportRow.findMany({ where: { packageId: id }, take: 10001,
        select: { id: true, sheet: true, relationId: true, rowNumber: true, sourceKey: true, fingerprint: true, payload: true, mapped: true, decision: true, decisionFingerprint: true, state: true, leadId: true } });
      const notes = await tx.importedHistoricalNote.findMany({ where: { row: { packageId: id } }, take: 100001,
        select: { rowId: true, leadId: true, cellKey: true, fingerprint: true, sourceSheet: true, sourceRow: true, sourceColumn: true, text: true, sourceValue: true, author: true, occurredAt: true } });
      const receipts = await tx.bootstrapImportReceipt.findMany({ where: { packageId: id, operation: "COMMIT_ROW" }, take: 10001, select: { key: true, fingerprint: true, actorId: true, response: true } });
      const provenance = row.batchId ? await tx.leadProvenance.findMany({ where: { batchId: row.batchId, sourceType: "LEGACY_CRM" }, take: 10001,
        select: { leadId: true, externalId: true, submissionFingerprint: true, technicalSystem: true, sourceType: true } }) : [];
      const targetIds = [...new Set(reconciliationRows.slice(0, 10000).flatMap((item) => item.leadId ? [item.leadId] : []))];
      const leads = await tx.lead.findMany({ where: { id: { in: targetIds } }, take: 10001, select: { id: true, campus: true, status: true, assignedToId: true, acquisitionKind: true, baselineTemperature: true,
        collaborators: { where: { active: true }, select: { userId: true } } } });
      const visibleLeads = [];
      const campuses = new Map<string, Awaited<ReturnType<typeof canonicalCampus>>>();
      const contexts = new Map<string, EvaluationContext>();
      for (const lead of leads) {
        // Equivalent to leadResource: actual canonical campus, active resource,
        // current owner and active membership. Cache only identical contexts
        // in this SAME read transaction/principal/permission snapshot.
        let campus = campuses.get(lead.campus);
        if (!campus) { campus = await canonicalCampus(tx, lead.campus); campuses.set(lead.campus, campus); }
        let visibleForCurrentAxes = true;
        for (const identity of identities) {
          const collaborating = lead.collaborators.some((item) => item.userId === identity.userId);
          const key = hash([identity.userId, campus.id, lead.assignedToId, collaborating]);
          let context = contexts.get(key);
          if (!context) {
            context = await resourceEvaluationContext(tx, identity, { scope: "CAMPUS", campusKeys: campus.keys, active: true,
              ...(lead.assignedToId ? { ownerId: lead.assignedToId } : {}), collaboratorIds: collaborating ? [identity.userId] : [], readableResource: true });
            contexts.set(key, context);
          }
          visibleForCurrentAxes = visibleForCurrentAxes && visible(identity, context);
        }
        visibleLeads.push({ ...lead, visibleForCurrentAxes });
      }
      const reconciliation = historicalReconciliation({ sha256: row.sha256 ?? "", rows: reconciliationRows.slice(0, 10000), notes: notes.slice(0, 100000), receipts: receipts.slice(0, 10000), provenance: provenance.slice(0, 10000), leads: visibleLeads.slice(0, 10000),
        truncated: reconciliationRows.length > 10000 || notes.length > 100000 || receipts.length > 10000 || provenance.length > 10000 || leads.length > 10000 });
      return { package: await this.view(tx, row), bySheet, sourceCoverage: { complete, bySheet: effectiveCoverage }, reconciliation,
        cutoverBlocked: !complete || !reconciliation.complete || bySheet.some((sheet) => sheet.review || sheet.invalid), historicalAcquisitionsExcluded: true };
  }

  async notes(leadId: string, actor: Principal): Promise<unknown> {
    if (!UUID.test(leadId)) this.notFound();
    return this.permissions.readTransaction(async (tx) => {
      const principal = await currentPrincipal(tx, actor); const context = await resourceEvaluationContext(tx, principal, await leadResource(tx, leadId));
      const snapshots = await this.permissions.snapshots(tx);
      if (!["lead.view", "interaction.view"].every((key) => evaluatePermission(principal, key, snapshots, context).allowed)) permissionDenied();
      const rows = await tx.importedHistoricalNote.findMany({ where: { leadId }, orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }, { sourceColumn: "asc" }], take: 1000 });
      const occurrences = await tx.bootstrapImportRow.findMany({ where: { leadId }, orderBy: [{ sheet: "asc" }, { rowNumber: "asc" }], take: 100 });
      return { items: rows.filter((row) => row.text.trim().length > 0).map((row) => ({ id: row.id, text: row.text, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, sourceColumn: row.sourceColumn, author: row.author, sourceDate: object<{ sourceDate?: string | null }>(row.sourceValue)?.sourceDate ?? null,
        occurredAt: row.occurredAt?.toISOString() ?? null, importedAt: row.importedAt.toISOString() })), historical: true, truncated: rows.length === 1000, preservedNonInteractionBlankRecords: rows.filter((row) => !row.text.trim()).length,
        provenance: occurrences.map((row) => { const mapped = object<MappedRow>(row.mapped); const decision = object<HistoricalDecisionInput>(row.decision); const cycle = decision?.cycle; return { sheet: row.sheet, rowNumber: row.rowNumber,
          cycleLabel: cycle?.state === "CONFIRMED_TARGET" ? `Candidature ${cycle.label}` : cycle?.state === "HISTORICAL_ENROLMENT" ? `Inscription antérieure ${cycle.label}` : cycle?.state === "REVIEW" ? "Cycle à vérifier" : "Cycle à préciser",
          cycle: this.cycleView(cycle, object<SourceRow>(row.payload)), receivedDateEvidence: mapped.receivedDateEvidence ?? null, sourceOwner: mapped.sourceOwner, replacementOwner: mapped.replacementOwner, originalSource: mapped.originalSource, rawStatus: mapped.rawStatus ?? null }; }), provenanceTruncated: occurrences.length === 100 };
    });
  }

  private async commitRow(tx: PermissionTransaction, packageRow: BootstrapImportPackage, row: BootstrapImportRow, actor: Principal): Promise<void> {
    const decision = object<HistoricalDecisionInput & { values: Values }>(row.decision); const mapped = object<MappedRow>(row.mapped);
    if (!decision || object<{ actorId: string }>(row.decision).actorId !== actor.userId || row.fingerprint !== hash(row.payload)) this.conflict("bootstrap_source_integrity_conflict");
    if (decision.action === "IGNORE") {
      await tx.bootstrapImportRow.update({ where: { id: row.id, version: row.version }, data: { state: "IGNORED", version: { increment: 1 } } });
      await this.rowReceipt(tx, packageRow, row, actor, null); return;
    }
    let leadId = decision.targetLeadId;
    if (decision.action === "CREATE_DOSSIER") {
      const values = baselineOptionalValues(decision.values, mapped.values, mapped.reasons);
      await this.validateCreate(tx, actor, packageRow, row, values, decision);
      const campus = await canonicalCampus(tx, packageRow.campusId);
      const reference = await validateLeadReferences(tx, { campus: campus.keys[1]!, campaign: values.campaign!, program: values.program! }, undefined, { allowMissingBaselineProgram: true });
      leadId = randomUUID();
      await tx.lead.create({ data: { id: leadId, leadCode: `LD-${new Date().getUTCFullYear()}-${leadId.slice(0, 8).toUpperCase()}`, acquisitionKind: "BASELINE", firstName: values.firstName!.trim(), lastName: values.lastName!.trim(),
        email: normalizeHistoricalEmail(values.email), phone: normalizeHistoricalPhone(values.phone), ...reference, educationLevel: values.educationLevel!.trim(), source: values.source!.trim(),
        status: values.status!, baselineTemperature: values.temperature || null, assignedToId: values.ownerId || null, assignmentMode: "HISTORICAL_EXPLICIT", importBatchId: packageRow.batchId } });
    } else if (decision.action === "LINK_EXISTING" && leadId) {
      this.validateSourceCoverage(mapped, decision, object<SourceRow>(row.payload));
      await this.authorizeLinkedLead(tx, actor, packageRow, leadId);
      if (mapped.reasons.some((reason) => reason.startsWith("FORMULA_REVIEW:comment:"))) throw new UnprocessableEntityException({ code: "bootstrap_formula_comment_review_required" });
    }
    else this.conflict("bootstrap_decision_missing");
    await tx.leadProvenance.create({ data: { leadId, batchId: packageRow.batchId!, sourceType: "LEGACY_CRM", technicalSystem: "EXCEL_BOOTSTRAP_R8", originalSource: (mapped.originalSource || row.sheet).slice(0, 120), recentSource: (mapped.originalSource || row.sheet).slice(0, 120),
      campaign: mapped.values.campaign ?? null, externalId: row.sourceKey, rawStatus: this.rawMappedStatus(row), submissionFingerprint: row.fingerprint } });
    const source = object<SourceRow>(row.payload);
    for (const comment of mapped.comments) {
      if (!comment.text.trim()) continue; // Source/replay receipts remain intact; blank evidence is not an interaction.
      const cellKey = hash([packageRow.sha256, row.relationId, row.rowNumber, comment.column]);
      await tx.importedHistoricalNote.create({ data: { rowId: row.id, leadId, cellKey, fingerprint: hash(source.cells[comment.column]), sourceSheet: row.sheet, sourceRow: row.rowNumber, sourceColumn: comment.column,
        text: comment.text, sourceValue: json(source.cells[comment.column]), author: null, occurredAt: null } });
    }
    for (const native of source.annotations ?? []) {
      const disposition = decision.annotations!.find((item) => item.annotationId === native.annotationId && item.reference === native.reference && item.relationshipId === native.relationshipId)!;
      if (disposition.action !== "PRESERVE_NOTE") continue;
      if (!native.text.trim()) continue;
      const sourceColumn = native.reference.replace(/\d+$/, ""); const cellKey = hash([packageRow.sha256, row.relationId, row.rowNumber, "native-annotation", native.relationshipId, native.annotationId, native.reference]);
      await tx.importedHistoricalNote.create({ data: { rowId: row.id, leadId, cellKey, fingerprint: hash(native), sourceSheet: row.sheet, sourceRow: row.rowNumber, sourceColumn,
        text: native.text, sourceValue: json(native), author: native.author, occurredAt: null } });
    }
    await tx.bootstrapImportRow.update({ where: { id: row.id, version: row.version }, data: { state: "ACCEPTED", leadId, version: { increment: 1 } } });
    await this.rowReceipt(tx, packageRow, row, actor, leadId);
  }
  private async revalidateDecision(tx: PermissionTransaction, packageRow: BootstrapImportPackage, row: BootstrapImportRow, actor: Principal): Promise<void> {
    const decision = object<HistoricalDecisionInput & { actorId: string; values: Values }>(row.decision);
    if (!decision || decision.actorId !== actor.userId || row.fingerprint !== hash(row.payload)) this.conflict("bootstrap_source_integrity_conflict");
    this.validateAnnotations(decision, object<SourceRow>(row.payload));
    if (decision.action === "CREATE_DOSSIER") {
      await this.validateCreate(tx, actor, packageRow, row, decision.values, decision);
      if (!row.leadId) this.conflict("bootstrap_receipt_integrity_invalid");
      const principal = await currentPrincipal(tx, actor); const context = await resourceEvaluationContext(tx, principal, await leadResource(tx, row.leadId));
      if (!evaluatePermission(principal, "lead.view", await this.permissions.snapshots(tx), context).allowed) permissionDenied();
    } else if (decision.action === "LINK_EXISTING") await this.authorizeLinkedLead(tx, actor, packageRow, decision.targetLeadId!);
  }

  private async validateCreate(tx: PermissionTransaction, actor: Principal, packageRow: BootstrapImportPackage, row: BootstrapImportRow, values: Values, decision: HistoricalDecisionInput): Promise<void> {
    await this.authorize(tx, actor, packageRow.campusId, ["lead.create"]);
    const mapped = object<MappedRow>(row.mapped);
    values = baselineOptionalValues(values, mapped.values, mapped.reasons);
    if (row.state !== "ACCEPTED") requireExplicitHistoricalStatus(mapped.reasons, decision, mapped.rawStatus ?? null);
    for (const key of ["firstName", "lastName", "campaign", "source", "status"]) if (!values[key]?.trim()) throw new UnprocessableEntityException({ code: "bootstrap_required_value_missing", field: key });
    if (values.firstName!.length > 100 || values.lastName!.length > 100 || values.educationLevel!.length > 80 || values.source!.length > 80 || !statuses.includes(values.status!)) refuse("bootstrap_lead_values_invalid");
    if (!values.email?.trim() && !values.phone?.trim()) refuse("bootstrap_contact_required");
    if (values.email?.trim() && !normalizeHistoricalEmail(values.email)) refuse("bootstrap_email_invalid");
    if (values.phone?.trim() && !normalizeHistoricalPhone(values.phone)) throw new UnprocessableEntityException({ code: "bootstrap_phone_explicit_resolution_required" });
    if (!sources.includes(values.source!) || (values.educationLevel && !educationLevels.includes(values.educationLevel)) || !["COLD", "WARM", "HOT", "UNEVALUATED"].includes(values.temperature ?? "")) refuse("bootstrap_lead_domain_invalid");
    this.validateSourceCoverage(mapped, decision, object<SourceRow>(row.payload));
    if (mapped.reasons.includes("HISTORICAL_DUPLICATE_STATUS_REVIEW")) throw new UnprocessableEntityException({ code: "bootstrap_duplicate_requires_link_or_ignore" });
    if (mapped.reasons.some((reason) => reason.startsWith("FORMULA_REVIEW"))) {
      const fields = mapped.reasons.filter((reason) => reason.startsWith("FORMULA_REVIEW:")).map((reason) => reason.slice(15));
      if (fields.some((field) => field.startsWith("comment:") || (field === "owner" || field === "replacementOwner" ? !Object.hasOwn(decision.overrides ?? {}, "ownerId") : !decision.overrides?.[field as keyof NonNullable<HistoricalDecisionInput["overrides"]>]))) throw new UnprocessableEntityException({ code: "bootstrap_formula_review_required" });
    }
    if (["ENROLLED", "CLOSED_LOST"].includes(values.status!) && !decision.overrides?.status) throw new UnprocessableEntityException({ code: "bootstrap_terminal_status_explicit_resolution_required" });
    if (["ENROLLED", "CLOSED_LOST"].includes(values.status!) && (mapped.values.status !== values.status || mapped.reasons.includes("FORMULA_REVIEW:status"))
      && !(values.status === "ENROLLED" && decision.cycle?.state === "HISTORICAL_ENROLMENT" && decision.cycle.sourceColumns.length)) throw new UnprocessableEntityException({ code: "bootstrap_terminal_source_evidence_required" });
    const campus = await canonicalCampus(tx, packageRow.campusId);
    await validateLeadReferences(tx, { campus: campus.keys[1]!, program: values.program!, campaign: values.campaign! }, undefined, { allowMissingBaselineProgram: true });
    if (mapped.reasons.includes("OWNER_UNKNOWN") && !Object.hasOwn(decision.overrides ?? {}, "ownerId")) throw new UnprocessableEntityException({ code: "bootstrap_owner_review_required" });
    if (!values.ownerId && decision.overrides?.ownerId !== "") throw new UnprocessableEntityException({ code: "bootstrap_unassigned_explicit_resolution_required" });
    if (values.ownerId) {
      await this.authorize(tx, actor, packageRow.campusId, ["lead.assign"]);
      if (!UUID.test(values.ownerId)) refuse("bootstrap_owner_invalid");
      const owner = await tx.collaborator.findUnique({ where: { id: values.ownerId } });
      if (!owner?.active || owner.firstLoginRequired || !owner.campusId || !campus.keys.includes(owner.campusId)) permissionDenied();
      const context = await resourceEvaluationContext(tx, await currentPrincipal(tx, actor), { scope: "CAMPUS", campusKeys: campus.keys, active: true, ownerId: owner.id });
      if (!assignmentCandidateCapability(owner.roles as Principal["roles"], await this.permissions.snapshots(tx), context)) permissionDenied();
    }
    // A committed receipt replay has no CREATE effect. Later legitimate
    // dossiers sharing this contact cannot invalidate the historical receipt.
    if (row.state !== "ACCEPTED") await requireNoHistoricalContactCollision(tx, { campusId: campus.id, campusKeys: campus.keys, rowId: row.id,
      email: normalizeHistoricalEmail(values.email), phone: normalizeHistoricalPhone(values.phone) });
  }

  private async authorizeLinkedLead(tx: PermissionTransaction, actor: Principal, packageRow: BootstrapImportPackage, id: string): Promise<void> {
    const principal = await currentPrincipal(tx, actor); const resource = await leadResource(tx, id); const campus = await canonicalCampus(tx, packageRow.campusId);
    if (!resource.campusKeys.includes(campus.id)) permissionDenied();
    const context = await resourceEvaluationContext(tx, principal, resource); const snapshots = await this.permissions.snapshots(tx);
    if (!["lead.view", "lead.edit"].every((key) => evaluatePermission(principal, key, snapshots, context).allowed)) permissionDenied();
  }
  private async rowReceipt(tx: PermissionTransaction, packageRow: BootstrapImportPackage, row: BootstrapImportRow, actor: Principal, leadId: string | null): Promise<void> {
    const decision = object<HistoricalDecisionInput & { values: Values }>(row.decision);
    await tx.bootstrapImportReceipt.create({ data: { packageId: packageRow.id, operation: "COMMIT_ROW", key: row.id, fingerprint: row.decisionFingerprint!, actorId: actor.userId, response: { rowId: row.id, leadId,
      assignment: decision.action === "CREATE_DOSSIER" ? decision.values.ownerId ? "OWNER_EXPLICIT_ASSIGNED" : "OWNER_EXPLICIT_UNASSIGNED" : "EXISTING_OWNER_PRESERVED" } } });
    await this.audit(tx, actor, packageRow, "BOOTSTRAP_ROW_COMMITTED", `row:${row.id}`, { rowId: row.id, leadId, sourceKey: row.sourceKey, fingerprint: row.fingerprint });
  }
  private rawMappedStatus(row: BootstrapImportRow): string | null {
    return object<MappedRow>(row.mapped).rawStatus?.slice(0, 120) ?? null;
  }
  private validateSourceCoverage(mapped: MappedRow, decision: HistoricalDecisionInput, source: SourceRow): void {
    if (mapped.reasons.some((reason) => reason.startsWith("UNMAPPED_SOURCE_CELL_REVIEW:") || reason === "ORPHAN_COMMENT_REVIEW")) throw new UnprocessableEntityException({ code: "bootstrap_source_coverage_review_required" });
    this.validateAnnotations(decision, source);
  }
  private validateAnnotations(decision: HistoricalDecisionInput, source: SourceRow): void {
    const annotations = source.annotations ?? []; const resolutions = decision.annotations;
    if (resolutions !== undefined && (!Array.isArray(resolutions) || resolutions.length > 100 || resolutions.some((item) => !record(item) || Object.keys(item).some((key) => !["annotationId", "reference", "relationshipId", "action", "reason"].includes(key)) || typeof item.annotationId !== "string" || typeof item.reference !== "string" || typeof item.relationshipId !== "string"
      || !["PRESERVE_NOTE", "EXCLUDE"].includes(item.action) || typeof item.reason !== "string" || item.reason.trim().length < 8 || item.reason.length > 1000 || !annotations.some((annotation) => annotation.annotationId === item.annotationId && annotation.reference === item.reference && annotation.relationshipId === item.relationshipId))
      || new Set(resolutions.map((item) => `${item.relationshipId}:${item.annotationId}:${item.reference}`)).size !== resolutions.length)) refuse("bootstrap_annotation_resolution_invalid");
    if (decision.action !== "IGNORE" && annotations.length !== (resolutions?.length ?? 0)) throw new UnprocessableEntityException({ code: "bootstrap_annotation_resolution_required" });
    if (resolutions?.some((item) => item.action === "PRESERVE_NOTE" && (annotations.find((annotation) => annotation.annotationId === item.annotationId && annotation.reference === item.reference && annotation.relationshipId === item.relationshipId)?.author?.length ?? 0) > 120)) throw new UnprocessableEntityException({ code: "bootstrap_annotation_author_length_review_required" });
  }
  private validateCycle(cycle: HistoricalCycle | undefined, source: SourceRow): void {
    if (cycle === undefined) return;
    if (!record(cycle) || Object.keys(cycle).some((key) => !["state", "label", "sourceColumns", "reason"].includes(key)) || !["UNSPECIFIED", "CONFIRMED_TARGET", "HISTORICAL_ENROLMENT", "REVIEW"].includes(cycle.state)
      || typeof cycle.reason !== "string" || cycle.reason.length > 1000 || !Array.isArray(cycle.sourceColumns) || cycle.sourceColumns.length > 6 || new Set(cycle.sourceColumns).size !== cycle.sourceColumns.length
      || cycle.sourceColumns.some((column) => typeof column !== "string" || !COLUMN.test(column) || !source.cells[column] || text(source.cells[column]) === null || !text(source.cells[column])!.trim())) refuse("bootstrap_cycle_invalid");
    if (cycle.state === "UNSPECIFIED") { if (cycle.label !== undefined || cycle.sourceColumns.length) refuse("bootstrap_cycle_invalid"); return; }
    if (cycle.reason.trim().length < 8 || !cycle.sourceColumns.length) refuse("bootstrap_cycle_evidence_required");
    if (cycle.label !== undefined && (typeof cycle.label !== "string" || !/^20\d{2}-20\d{2}$/.test(cycle.label) || Number(cycle.label.slice(5)) !== Number(cycle.label.slice(0, 4)) + 1)) refuse("bootstrap_cycle_label_invalid");
    if (["CONFIRMED_TARGET", "HISTORICAL_ENROLMENT"].includes(cycle.state) && !cycle.label) refuse("bootstrap_cycle_label_required");
    if (cycle.sourceColumns.some((column) => source.cells[column]!.formula)) throw new UnprocessableEntityException({ code: "bootstrap_cycle_formula_not_evidence" });
  }
  private cycleView(cycle: HistoricalCycle | undefined, source: SourceRow): unknown {
    return { ...(cycle ?? { state: "UNSPECIFIED", sourceColumns: [], reason: "" }), evidence: (cycle?.sourceColumns ?? []).map((column) => ({ column, reference: `${column}${source.rowNumber}`, text: text(source.cells[column]), formula: !!source.cells[column]?.formula })) };
  }
  private async package(tx: PermissionTransaction, id: string, actor: Principal, keys: string[]): Promise<BootstrapImportPackage> {
    if (!UUID.test(id)) this.notFound(); const row = await tx.bootstrapImportPackage.findUnique({ where: { id } }); if (!row) this.notFound();
    await this.authorize(tx, actor, row.campusId, keys); return row;
  }
  private async authorize(tx: PermissionTransaction, actor: Principal, campusId: string, keys: string[]): Promise<void> {
    const principal = await currentPrincipal(tx, actor); const campus = await canonicalCampus(tx, campusId);
    const context = await resourceEvaluationContext(tx, principal, { scope: "CAMPUS", campusKeys: campus.keys, active: true }); const snapshots = await this.permissions.snapshots(tx);
    if (!keys.every((key) => evaluatePermission(principal, key, snapshots, context).allowed)) permissionDenied();
  }
  private async counts(tx: PermissionTransaction, id: string): Promise<{ total: number; accepted: number; review: number; invalid: number; ignored: number; pending: number }> {
    const rows = await tx.bootstrapImportRow.groupBy({ by: ["state"], where: { packageId: id }, _count: true }); const count = (state: string): number => rows.find((row) => row.state === state)?._count ?? 0;
    return { total: rows.reduce((sum, row) => sum + row._count, 0), accepted: count("ACCEPTED"), review: count("REVIEW"), invalid: count("INVALID"), ignored: count("IGNORED"), pending: count("READY") };
  }
  private async view(tx: PermissionTransaction, row: BootstrapImportPackage): Promise<Record<string, unknown>> {
    const snapshot = row.snapshot ? object<Snapshot>(row.snapshot) : undefined;
    return { id: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes, sha256: row.sha256, campusId: row.campusId, state: row.state, version: row.version,
      receivedChunks: await tx.bootstrapImportChunk.count({ where: { packageId: row.id } }), expectedChunks: Math.ceil(row.sizeBytes / CHUNK_BYTES),
      sheets: snapshot?.sheets.map((sheet) => ({ name: sheet.name, relationId: sheet.relationId, rowCount: sheet.rows.length, columns: sheet.columns })) ?? [], counts: await this.counts(tx, row.id), ...(row.batchId ? { batchId: row.batchId } : {}) };
  }
  private rowView(row: BootstrapImportRow, actor?: Principal): Record<string, unknown> {
    const mapped = object<MappedRow>(row.mapped); const decision = row.decision ? object<HistoricalDecisionInput & { values: Values; actorId: string }>(row.decision) : undefined; const source = object<SourceRow>(row.payload);
    const statusResolution = ["REVIEW", "READY"].includes(row.state) ? historicalStatusResolutionReason(mapped.rawStatus ?? null) : null;
    const reasons = [...new Set([...row.reasons, ...(statusResolution ? [statusResolution] : [])])];
    const warnings = BASELINE_OPTIONAL_INFORMATION.filter((field) => !mapped.values[field]?.trim() && !reasons.includes(`FORMULA_REVIEW:${field}`)).map((field) => `BASELINE_INFORMATION_UNKNOWN:${field}`);
    if (reasons.includes("OWNER_MISSING")) warnings.push("OWNER_MISSING"); // Explicit unassigned decision is still required; no arbitrary redistribution.
    const blockingReasons = reasons.filter((reason) => !warnings.includes(reason) && !reason.startsWith("BASELINE_INFORMATION_UNKNOWN:") && !BASELINE_OPTIONAL_INFORMATION.some((field) => reason === `REQUIRED_MAPPING_MISSING:${field}` && warnings.includes(`BASELINE_INFORMATION_UNKNOWN:${field}`)));
    return { id: row.id, sheet: row.sheet, rowNumber: row.rowNumber, fingerprint: row.fingerprint, version: row.version, state: row.state, reasons, warnings, blockingReasons, values: mapped.values, comments: mapped.comments.filter((comment) => comment.text.trim().length > 0),
      canReopen: row.state === "READY" && !row.leadId && !!actor && decision?.actorId === actor.userId,
      sourceOwner: mapped.sourceOwner, replacementOwner: mapped.replacementOwner, annotations: source.annotations ?? [], sourceEvidence: Object.entries(source.cells).map(([column, cell]) => ({ column, reference: `${column}${source.rowNumber}`, text: text(cell), raw: cell.raw, type: cell.type,
        formula: !!cell.formula, ...(cell.formula ? { formulaText: cell.formula.text } : {}), ...(cell.style ? { style: cell.style } : {}) })), sourceEvidenceTruncated: false,
      ...(decision ? { decision: { action: decision.action, reason: decision.reason, ...(decision.targetLeadId ? { targetLeadId: decision.targetLeadId } : {}),
        overrides: decision.overrides ?? {}, resolvedValues: decision.values, annotations: decision.annotations ?? [], cycle: this.cycleView(decision.cycle, source) } } : {}), ...(row.leadId ? { leadId: row.leadId } : {}) };
  }
  private async audit(tx: PermissionTransaction, actor: Principal, row: BootstrapImportPackage, eventType: string, key: string, after: unknown): Promise<void> {
    const current = await currentPrincipal(tx, actor);
    await tx.auditEvent.create({ data: { actorId: current.userId, actorRoles: current.roles, campusId: row.campusId, resourceType: "BOOTSTRAP_IMPORT", resourceId: row.id, eventType, result: "SUCCESS", idempotencyKey: `bootstrap:${key}`, correlationId: `bootstrap:${row.id}`, after: json(after) } });
  }
  private conflict(code: string): never { throw new ConflictException({ code }); }
  private notFound(): never { throw new NotFoundException({ code: "bootstrap_package_not_found" }); }
}
