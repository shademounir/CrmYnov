import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Prisma, SheetImportConnector } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { ImportMappingService, type ImportMappingTemplate } from "../import-mapping/import-mapping.service.js";
import { validateLeadReferences } from "../references/reference.repository.js";
import { readSheetConfiguration, sheetObject, sheetText, type SheetConfiguration } from "./sheet-import-configuration.js";
import { workbookId, type SheetValues } from "./google-sheets-adapter.js";
import type { IngestionRecordInput } from "../ingestion/ingestion.service.js";
import { sheetInterval } from "./sheet-import-policy.js";
import { assertSheetAuthority } from "./sheet-import-authority.js";
import { SheetSource } from "./synthetic-sheet-source.js";
import { RoutedSheetSource } from "./google-sheet-source.js";
import { sheetStreamId } from "./sheet-local-ledger.js";
import { localObservation } from "./sheet-local-ledger.js";
import { evaluateLocalMappedRow } from "./sheet-local-simulation.js";
import { cutoverConnectorBound } from "../cutover/cutover.store.js";
import { parseSheetLocalRange, reconcileSheetObservation, type SheetLocalObservation } from "./sheet-local-observation.js";
import { APPEND_MODE, appendPositions } from "./sheet-append-contract.js";
import { appendObservationConflict, appendRows, appendStream, appendWorkerEnabled, assertAppendBinding, persistAppendObservation, registerAppendBoundary } from "./sheet-append-ledger.js";
import { privateAppendBoundary, privateAppendQualification } from "./sheet-append-boundary-file.js";
import { BootstrapImportService } from "../bootstrap-import/bootstrap-import.service.js";
import { assertAppendQualification, type SheetAppendQualification } from "./sheet-append-qualification.js";

type SimulationResult = { rows: number; mapped: number; review: number; mutated: false; simulated: boolean; reconciliationRequired: boolean; reason: string | null };

function simulationSourceRows(row: SheetImportConnector, configuration: SheetConfiguration, values: SheetValues): { rows: Record<string, string>[]; observation?: SheetLocalObservation } {
  if (configuration.source?.identityMode !== "LOCAL_ROW") return { rows: values.rows };
  const observed = values.observation;
  if (!observed || observed.sheetId !== configuration.source.sheetId || observed.range !== configuration.source.range) throw new BadRequestException({ code: "sheet_observation_missing" });
  const observation = localObservation(row.workbookId, observed.sheetId, observed.range, observed.values);
  return { observation, rows: observed.values.slice(1).map((cells) => Object.fromEntries(values.columns.map((column, index) => [column, cells[index] ?? ""]))) };
}

function hasSimulationFields(record: IngestionRecordInput | undefined, local: boolean): record is IngestionRecordInput & { campus: string; program: string; campaign: string; educationLevel: string } {
  return Boolean(record && (local || record.externalId) && record.campus && record.program && record.campaign && record.educationLevel);
}

async function localSimulationReason(tx: Prisma.TransactionClient, row: SheetImportConnector, observation: SheetLocalObservation): Promise<string | null> {
  const id = sheetStreamId(row.workbookId, observation.scope.sheetId);
  const stream = await tx.sheetLocalStream.findUnique({ where: { id } });
  if (!stream) return null; // A first simulation observes, but never establishes a baseline.
  if (stream.campusId !== row.campusId) throw new NotFoundException({ code: "sheet_connector_not_found" });
  if (stream.suspended) return stream.errorCode ?? "sheet_reconciliation_required";
  const previousRows = await tx.sheetLocalRow.findMany({ where: { streamId: id }, orderBy: { rowNumber: "asc" }, take: 10_000 });
  const previous: SheetLocalObservation = { scope: { ...observation.scope, ...parseSheetLocalRange(stream.range) }, headerFingerprint: stream.headerFingerprint,
    positions: previousRows.map((item) => ({ row: item.rowNumber, fingerprint: item.fingerprint, empty: item.status === "EMPTY" })) };
  const check = reconcileSheetObservation(previous, observation);
  return check.kind === "RECONCILIATION" ? check.reason : null;
}

async function knownSimulationReferences(tx: Prisma.TransactionClient, campus: string, program: string, campaign: string, expectedCampus: string): Promise<boolean> {
  try {
    const references = await validateLeadReferences(tx, { campus, program, campaign });
    if (references.campus !== expectedCampus) throw new ForbiddenException({ code: "sheet_source_scope_refused" });
    return true;
  }
  catch (error) {
    if (error instanceof UnprocessableEntityException) {
      const response = error.getResponse();
      if (typeof response === "object" && "code" in response && response.code === "REFERENCE_VALUE_UNKNOWN") return false;
    }
    throw error;
  }
}

type ConnectorView = Pick<SheetImportConnector, "id" | "campusId" | "workbookId" | "tab" | "enabled" | "intervalMinutes" | "version" | "nextRunAt" | "manualRequested"> & { configuration: SheetConfiguration; simulated: boolean };
function view(row: SheetImportConnector): ConnectorView {
  return { id: row.id, campusId: row.campusId, workbookId: row.workbookId, tab: row.tab, enabled: row.enabled,
    intervalMinutes: row.intervalMinutes, version: row.version, nextRunAt: row.nextRunAt, manualRequested: row.manualRequested,
    configuration: readSheetConfiguration(row.configuration), simulated: readSheetConfiguration(row.configuration).source?.mode !== "GOOGLE" };
}
function configurationJson(value: SheetConfiguration): Prisma.InputJsonObject {
  return { ...(value.source ? { source: { ...value.source } } : {}), mapping: { ...value.mapping, columns: value.mapping.columns.map((column) => ({ ...column })) }, context: { ...value.context }, assignment: { ...value.assignment } };
}
function identifier(value: string): string {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu.test(value)) throw new BadRequestException({ code: "sheet_identifier_invalid" });
  return value;
}
function appendCommand(raw: unknown): Record<string, unknown> & { confirmed: true; expectedVersion: number } {
  const body = sheetObject(raw);
  if (Object.keys(body).some((key) => !["confirmed", "expectedVersion"].includes(key)) || body.confirmed !== true || typeof body.expectedVersion !== "number" || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw new BadRequestException({ code: "sheet_append_confirmation_required" });
  return body as Record<string, unknown> & { confirmed: true; expectedVersion: number };
}

@Injectable()
export class SheetImportAdminService {
  constructor(@Inject(DynamicPermissionRepository) private readonly repository: DynamicPermissionRepository,
    @Inject(ImportMappingService) private readonly mappings: ImportMappingService, @Inject(SheetSource) private readonly source: SheetSource,
    @Optional() @Inject(BootstrapImportService) private readonly bootstrap?: BootstrapImportService) {}

  async list(actor: Principal, campusValue: string): Promise<{ connectors: ConnectorView[]; mappings: ImportMappingTemplate[]; simulated: boolean; googleReady: boolean }> {
    return this.repository.readTransaction(async (tx) => {
      const campus = await canonicalCampus(tx, sheetText(campusValue));
      const current = await this.authorize(tx, actor, campus.id, ["settings.campus.manage", "import.view"]);
      const rows = await tx.sheetImportConnector.findMany({ where: { campusId: campus.id }, orderBy: { id: "asc" }, take: 100 });
      return { connectors: rows.map(view), mappings: this.mappings.list(current).filter((mapping) => mapping.profile === "FORMINATOR_ZAPIER" || mapping.profile === "CUSTOM"),
        simulated: rows.every((row) => view(row).simulated), googleReady: this.source instanceof RoutedSheetSource && this.source.googleReady };
    });
  }

  async save(actor: Principal, raw: unknown, id?: string): Promise<ConnectorView> {
    const body = sheetObject(raw);
    const expected = body.expectedVersion;
    if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 || typeof body.enabled !== "boolean") throw new BadRequestException({ code: "sheet_configuration_invalid" });
    if (body.intervalMinutes !== undefined && (typeof body.intervalMinutes !== "number" || !Number.isInteger(body.intervalMinutes) || body.intervalMinutes < 5 || body.intervalMinutes > 15)) throw new BadRequestException({ code: "sheet_interval_invalid" });
    const interval = sheetInterval(typeof body.intervalMinutes === "number" ? body.intervalMinutes : 15);
    let workbook: string;
    try { workbook = workbookId(sheetText(body.workbookLink, 400)); }
    catch { throw new BadRequestException({ code: "sheet_workbook_link_invalid" }); }
    return this.repository.transaction(async (tx) => {
      const campus = await canonicalCampus(tx, sheetText(body.campusId));
      const current = await this.authorize(tx, actor, campus.id, ["settings.campus.manage"]);
      const previous = id ? await this.connector(tx, current, id) : null;
      if ((previous?.version ?? 0) !== expected || previous && previous.campusId !== campus.id) throw new ConflictException({ code: "sheet_version_conflict" });
      if (body.enabled && previous && await cutoverConnectorBound(tx, previous.id)) throw new ConflictException({ code: "sheet_cutover_preparation_only" });
      if (body.enabled && previous?.leaseUntil && previous.leaseUntil > new Date()) throw new ConflictException({ code: "sheet_execution_active" });
      const template = sheetObject(body.mapping);
      const parsed = readSheetConfiguration({ mapping: { ...template, id: "pending", version: expected + 1, createdBy: current.userId, createdAt: new Date().toISOString() },
        context: body.context, assignment: body.assignment, source: body.source });
      if (parsed.source?.mode !== "GOOGLE" && !workbook.startsWith("synthetic_")) throw new BadRequestException({ code: "sheet_real_source_disabled" });
      const configuration: SheetConfiguration = { ...parsed, mapping: this.mappings.snapshot({ ...parsed.mapping, expectedVersion: expected }, current.userId, new Date().toISOString()) };
      if (configuration.source?.identityMode === APPEND_MODE && configuration.mapping.columns.some((column) => ["externalId", "occurredAt", "historicalStatus", "comment"].includes(column.targetField ?? "") && !["IGNORE", "METADATA"].includes(column.action))) {
        throw new BadRequestException({ code: "sheet_append_inferred_identity_or_history_refused" });
      }
      const reference = await tx.crmReference.findUniqueOrThrow({ where: { id: campus.id } });
      if (configuration.context.campus !== reference.code) throw new BadRequestException({ code: "sheet_campus_mapping_invalid" });
      const enabled = body.enabled === true;
      if (enabled && typeof configuration.source?.sheetId === "number" && await cutoverConnectorBound(tx, previous?.id ?? randomUUID(), { workbookId: workbook, sheetId: configuration.source.sheetId })) throw new ConflictException({ code: "sheet_cutover_preparation_only" });
      this.validateActivationSource(enabled, workbook, body.tab, configuration);
      if (configuration.source?.identityMode === APPEND_MODE && enabled) {
        if (!appendWorkerEnabled(process.env) || process.env.CRM_SHEET_APPEND_POLICY_QUALIFIED !== "true") throw new ConflictException({ code: "sheet_append_policy_not_qualified" });
        const stream = await assertAppendBinding(tx, { workbookId: workbook, tab: sheetText(body.tab, 100), campusId: campus.id }, configuration, true);
        await assertAppendQualification(tx, stream, this.repository, this.bootstrap, configuration.assignment.strategy !== "UNASSIGNED");
      } else if (configuration.source?.sheetId !== undefined) {
        const bound = await appendStream(tx, sheetStreamId(workbook, configuration.source.sheetId));
        if (bound?.contract && configuration.source.identityMode !== APPEND_MODE) throw new ConflictException({ code: "sheet_append_legacy_execution_refused" });
      }
      await this.validateConfiguredLocalStream(tx, campus.id, workbook, configuration, enabled);
      if (enabled) await this.authorizeActivation(tx, current.userId, campus.id, configuration, id);
      const data = { campusId: campus.id, workbookId: workbook, tab: sheetText(body.tab, 100), enabled, intervalMinutes: interval,
        version: expected + 1, updatedBy: current.userId, configuration: configurationJson(configuration), nextRunAt: new Date() };
      if (!enabled && previous?.activeRunId) {
        await tx.sheetImportRun.update({ where: { id: previous.activeRunId }, data: { status: "CANCELLED", errorCode: "sheet_connector_disabled", completedAt: new Date() } });
      }
      const row = previous ? await tx.sheetImportConnector.update({ where: { id: previous.id, version: expected }, data }) : await tx.sheetImportConnector.create({ data });
      if (!enabled) await tx.sheetImportConnector.update({ where: { id: row.id }, data: { activeRunId: null, leaseUntil: null, manualRequested: false } });
      await tx.sheetImportConfigurationVersion.create({ data: { connectorId: row.id, version: row.version, snapshot: { ...data }, actorId: current.userId } });
      await this.audit(tx, current, row, "SHEET_IMPORT_CONFIGURED", { version: row.version, enabled, intervalMinutes: interval });
      return view(row);
    });
  }

  private validateActivationSource(enabled: boolean, workbook: string, tab: unknown, configuration: SheetConfiguration): void {
    if (!enabled) return;
    if (this.source instanceof RoutedSheetSource) this.source.validateSelection(workbook, sheetText(tab, 100), configuration.source);
    if (configuration.source?.mode === "GOOGLE" && !(this.source instanceof RoutedSheetSource)) throw new BadRequestException({ code: "sheet_real_source_disabled" });
  }

  private async validateConfiguredLocalStream(tx: Prisma.TransactionClient, campusId: string, workbook: string, configuration: SheetConfiguration, enabled: boolean): Promise<void> {
    if (configuration.source?.identityMode !== "LOCAL_ROW" || configuration.source.sheetId === undefined) return;
    const stream = await tx.sheetLocalStream.findUnique({ where: { id: sheetStreamId(workbook, configuration.source.sheetId) } });
    if (stream && stream.campusId !== campusId) throw new ForbiddenException({ code: "sheet_source_scope_refused" });
    if (enabled && stream?.suspended) throw new ConflictException({ code: "sheet_reconciliation_required" });
  }

  private async authorizeActivation(tx: Prisma.TransactionClient, userId: string, campusId: string, configuration: SheetConfiguration, id?: string): Promise<void> {
    if (process.env.FORMINATOR_WEBHOOK_ENABLED === "true") throw new ConflictException({ code: "sheet_automatic_channel_active" });
    await assertSheetAuthority(tx, this.repository, userId, campusId, configuration.assignment.strategy !== "UNASSIGNED");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, 1)`;
    if (await tx.sheetImportConnector.count({ where: { enabled: true, ...(id ? { id: { not: id } } : {}) } })) throw new ConflictException({ code: "sheet_automatic_channel_active" });
  }

  async requestRun(actor: Principal, id: string, expectedVersion: number): Promise<{ queued: true; version: number }> {
    return this.repository.transaction(async (tx) => {
      const row = await this.connector(tx, actor, id);
      if (await cutoverConnectorBound(tx, row.id)) throw new ConflictException({ code: "sheet_cutover_preparation_only" });
      const config = readSheetConfiguration(row.configuration);
      if (config.source?.identityMode === APPEND_MODE) {
        if (!appendWorkerEnabled(process.env) || process.env.CRM_SHEET_APPEND_POLICY_QUALIFIED !== "true") throw new ConflictException({ code: "sheet_append_policy_not_qualified" });
        const stream = await assertAppendBinding(tx, row, config, true);
        await assertAppendQualification(tx, stream, this.repository, this.bootstrap, config.assignment.strategy !== "UNASSIGNED");
      }
      if (typeof config.source?.sheetId === "number" && await cutoverConnectorBound(tx, row.id, { workbookId: row.workbookId, sheetId: config.source.sheetId })) throw new ConflictException({ code: "sheet_cutover_preparation_only" });
      if ((!row.enabled && !["LOCAL_ROW", APPEND_MODE].includes(config.source?.identityMode ?? "")) || row.version !== expectedVersion) throw new ConflictException({ code: "sheet_disabled_or_version_conflict" });
      if (this.source instanceof RoutedSheetSource) this.source.validateSelection(row.workbookId, row.tab, config.source);
      if (config.source?.identityMode === "LOCAL_ROW" && config.source.sheetId !== undefined) {
        const stream = await tx.sheetLocalStream.findUnique({ where: { id: sheetStreamId(row.workbookId, config.source.sheetId) } });
        if (stream && (stream.suspended || stream.campusId !== row.campusId)) throw new ConflictException({ code: "sheet_reconciliation_required" });
      }
      await assertSheetAuthority(tx, this.repository, row.updatedBy, row.campusId, readSheetConfiguration(row.configuration).assignment.strategy !== "UNASSIGNED");
      const current = await this.authorize(tx, actor, row.campusId, ["settings.campus.manage", "import.execute", "import.confirm"]);
      if (row.activeRunId || row.manualRequested) throw new ConflictException({ code: "sheet_execution_active" });
      await tx.sheetImportConnector.update({ where: { id: row.id, version: expectedVersion }, data: { nextRunAt: new Date(), manualRequested: true } });
      await this.audit(tx, current, row, "SHEET_IMPORT_REQUESTED", { version: row.version });
      return { queued: true, version: row.version };
    });
  }

  async appendBoundary(actor: Principal, id: string, raw: unknown): Promise<unknown> {
    const body = appendCommand(raw);
    // Authorize before private I/O, then reauthorize the same version under the
    // permission fence. No client cells/path/N0/generation are accepted.
    await this.repository.readTransaction(async (tx) => {
      const row = await this.connector(tx, actor, id);
      await this.authorize(tx, actor, row.campusId, ["settings.campus.manage", "import.confirm"]);
      if (row.version !== body.expectedVersion) throw new ConflictException({ code: "sheet_version_conflict" });
    });
    const artifact = await privateAppendBoundary(process.env, resolve(__dirname, "../../../.."));
    return this.repository.transaction(async (tx) => {
      const row = await this.connector(tx, actor, id), current = await this.authorize(tx, actor, row.campusId, ["settings.campus.manage", "import.confirm"]);
      // Same lock as worker fence / config mutations; source unique advisory
      // lock inside registration also serializes two connector initializations.
      await tx.$queryRaw`SELECT id FROM sheet_import_connectors WHERE id=${row.id}::uuid FOR UPDATE`;
      const latest = await tx.sheetImportConnector.findUniqueOrThrow({ where: { id: row.id } });
      if (latest.version !== body.expectedVersion || await cutoverConnectorBound(tx, latest.id)) throw new ConflictException({ code: "sheet_version_or_cutover_conflict" });
      const config = readSheetConfiguration(latest.configuration);
      if (config.source?.sheetId !== undefined && await cutoverConnectorBound(tx, latest.id, { workbookId: latest.workbookId, sheetId: config.source.sheetId })) throw new ConflictException({ code: "sheet_cutover_preparation_only" });
      const contract = await registerAppendBoundary(tx, latest, config, artifact.boundary, artifact.sha256);
      const key = `sheet-append-boundary:${sheetStreamId(latest.workbookId, contract.sheetId)}`;
      if (!await tx.auditEvent.findUnique({ where: { idempotencyKey: key } })) await tx.auditEvent.create({ data: { actorId: current.userId, actorRoles: current.roles,
        campusId: row.campusId, resourceType: "SHEET_IMPORT", resourceId: row.id, eventType: "SHEET_APPEND_BOUNDARY_REGISTERED", result: "SUCCESS", correlationId: row.id,
        idempotencyKey: key, after: { generation: contract.generation, boundaryRow: contract.boundaryRow, capturedAt: contract.capturedAt, artifactSha256: contract.artifactSha256,
          producerAttested: false, automaticActivationPerformed: false } } });
      return { mode: APPEND_MODE, generation: contract.generation, boundaryRow: contract.boundaryRow, capturedAt: contract.capturedAt,
        artifactSha256: contract.artifactSha256, producerAttested: false, automaticActivationPerformed: false };
    });
  }

  async appendReconciliation(actor: Principal, id: string): Promise<unknown> {
    return this.repository.readTransaction(async (tx) => {
      const connector = await this.connector(tx, actor, id), config = readSheetConfiguration(connector.configuration);
      if (config.source?.identityMode !== APPEND_MODE || config.source.sheetId === undefined) throw new BadRequestException({ code: "sheet_append_mode_required" });
      const stream = await appendStream(tx, sheetStreamId(connector.workbookId, config.source.sheetId));
      if (!stream?.contract || stream.campusId !== connector.campusId) return { boundaryRegistered: false, rows: [] };
      const rows = await appendRows(tx, stream.id), count = (status: string): number => rows.filter((row) => row.status === status).length;
      const confirmedRows = rows.filter((row) => ["CREATED", "DUPLICATE", "IGNORED"].includes(row.status)).map((row) => row.rowNumber);
      return { boundaryRegistered: true, mode: APPEND_MODE, generation: stream.contract.generation, boundaryRow: stream.contract.boundaryRow,
        capturedAt: stream.contract.capturedAt, lastObservedRow: stream.lastObservedRow, lastDurableRow: stream.lastDurableRow,
        lastConfirmedRow: confirmedRows.length ? Math.max(...confirmedRows) : null, confirmedRows, notCoverageCursor: true,
        suspended: stream.suspended, reason: stream.errorCode, producerAttested: false, originalSubmissionTime: "UNKNOWN",
        qualificationRegistered: Boolean(stream.qualification), producerConditionConfirmed: Boolean(stream.qualification?.producerCondition), automaticEnabled: connector.enabled, workerFlagsEnabled: appendWorkerEnabled(process.env),
        bootstrapPackageId: stream.qualification?.bootstrapPackageId ?? null,
        counts: { observed: rows.length, pending: count("PENDING"), incomplete: count("INCOMPLETE"), review: count("REVIEW"), confirmed: count("CREATED") + count("DUPLICATE") + count("IGNORED") },
        rows: rows.map(({ rowNumber, occurrenceKey, status, firstObservedAt }) => ({ rowNumber, occurrenceKey, status, firstObservedAt, originalArrivedAt: null })) };
    });
  }

  async qualifyAppend(actor: Principal, id: string, raw: unknown): Promise<unknown> {
    const body = appendCommand(raw);
    await this.repository.readTransaction(async (tx) => {
      const row = await this.connector(tx, actor, id); await this.authorize(tx, actor, row.campusId, ["settings.campus.manage", "import.confirm"]);
      if (row.version !== body.expectedVersion) throw new ConflictException({ code: "sheet_version_conflict" });
    });
    const artifact = await privateAppendQualification(process.env, resolve(__dirname, "../../../.."));
    return this.repository.transaction(async (tx) => {
      const row = await this.connector(tx, actor, id), current = await this.authorize(tx, actor, row.campusId, ["settings.campus.manage", "import.confirm"]);
      await tx.$queryRaw`SELECT id FROM sheet_import_connectors WHERE id=${row.id}::uuid FOR UPDATE`;
      const latest = await tx.sheetImportConnector.findUniqueOrThrow({ where: { id: row.id } });
      if (latest.version !== body.expectedVersion || latest.enabled || latest.activeRunId || latest.manualRequested) throw new ConflictException({ code: "sheet_append_execution_must_be_stopped" });
      const config = readSheetConfiguration(latest.configuration), stream = await assertAppendBinding(tx, latest, config, true);
      const user = await tx.collaborator.findUniqueOrThrow({ where: { id: current.userId } });
      const qualification: SheetAppendQualification = { ...artifact.qualification, artifactSha256: artifact.sha256, delegation: {
        creatorId: current.userId, authorizedBy: current.userId, creatorAuthenticationVersion: user.authenticationVersion, authorizerAuthenticationVersion: user.authenticationVersion } };
      await assertAppendQualification(tx, { ...stream, qualification }, this.repository, this.bootstrap, config.assignment.strategy !== "UNASSIGNED");
      if (stream.qualification?.artifactSha256 === artifact.sha256) return { qualified: true, producerAttested: false, automaticActivationPerformed: false, artifactSha256: artifact.sha256, reportSha256: qualification.reportSha256 };
      await tx.$executeRaw`UPDATE sheet_local_streams SET append_qualification=${JSON.stringify(qualification)}::jsonb WHERE id=${stream.id}`;
      await this.audit(tx, current, latest, "SHEET_APPEND_QUALIFIED", { artifactSha256: artifact.sha256, evidenceSha256: qualification.evidenceSha256,
        bootstrapPackageId: qualification.bootstrapPackageId, reportSha256: qualification.reportSha256, producerAttested: false, automaticActivationPerformed: false });
      return { qualified: true, producerAttested: false, automaticActivationPerformed: false, artifactSha256: artifact.sha256, reportSha256: qualification.reportSha256 };
    });
  }

  async observeAppend(actor: Principal, id: string, raw: unknown): Promise<unknown> {
    const body = appendCommand(raw);
    const row = await this.repository.readTransaction(async (tx) => {
      const connector = await this.connector(tx, actor, id); await this.authorize(tx, actor, connector.campusId, ["settings.campus.manage", "import.execute", "import.confirm"]);
      if (connector.version !== body.expectedVersion || connector.enabled || connector.activeRunId || connector.manualRequested) throw new ConflictException({ code: "sheet_append_execution_must_be_stopped" });
      await assertAppendBinding(tx, connector, readSheetConfiguration(connector.configuration)); return connector;
    });
    const config = readSheetConfiguration(row.configuration), values = await this.source.read(row.workbookId, row.tab, config), observation = values.observation;
    if (!observation || observation.sheetId !== config.source?.sheetId || observation.range !== config.source.range) throw new BadRequestException({ code: "sheet_append_observation_missing" });
    return this.repository.transaction(async (tx) => {
      const latest = await this.connector(tx, actor, id); await this.authorize(tx, actor, latest.campusId, ["settings.campus.manage", "import.execute", "import.confirm"]);
      await tx.$queryRaw`SELECT id FROM sheet_import_connectors WHERE id=${latest.id}::uuid FOR UPDATE`;
      const locked = await tx.sheetImportConnector.findUniqueOrThrow({ where: { id: latest.id } });
      if (locked.version !== row.version || locked.enabled || locked.activeRunId || locked.manualRequested) throw new ConflictException({ code: "sheet_append_execution_must_be_stopped" });
      const run = await tx.sheetImportRun.create({ data: { connectorId: locked.id, status: "RUNNING", trigger: "MANUAL", configurationVersion: locked.version,
        configurationSnapshot: { observationOnly: true, configuration: locked.configuration } } });
      const consistent = await persistAppendObservation(tx, locked, config, run.id, observation.values);
      await tx.sheetImportRun.update({ where: { id: run.id }, data: { status: consistent ? "COMPLETED" : "FAILED", completedAt: new Date(), errorCode: consistent ? null : "sheet_append_reconciliation_required" } });
      return { runId: run.id, observationDurable: consistent, businessEffects: 0, automaticActivationPerformed: false };
    });
  }

  async history(actor: Principal, id: string, page = 1): Promise<Array<{ id: string; status: string; trigger: string; configurationVersion: number | null; createdCount: number; duplicateCount: number; reviewCount: number; ignoredCount: number; errorCode: string | null; startedAt: Date; completedAt: Date | null }>> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new BadRequestException({ code: "sheet_history_page_invalid" });
    return this.repository.readTransaction(async (tx) => {
      const row = await this.connector(tx, actor, id);
      return tx.sheetImportRun.findMany({ where: { connectorId: row.id }, orderBy: [{ startedAt: "desc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50,
        select: { id: true, status: true, trigger: true, configurationVersion: true, createdCount: true, duplicateCount: true, reviewCount: true,
          ignoredCount: true, errorCode: true, startedAt: true, completedAt: true } });
    });
  }

  async simulate(actor: Principal, id: string): Promise<SimulationResult> {
    const row = await this.repository.readTransaction((tx) => this.connector(tx, actor, id));
    const configuration = readSheetConfiguration(row.configuration);
    if (configuration.source?.identityMode === APPEND_MODE) return this.simulateAppend(actor, row, configuration);
    const values = await this.source.read(row.workbookId, row.tab, configuration);
    const { rows: sourceRows, observation } = simulationSourceRows(row, configuration, values);
    return this.repository.readTransaction(async (tx) => {
      const latest = await this.connector(tx, actor, id);
      if (latest.version !== row.version) throw new ConflictException({ code: "sheet_version_conflict" });
      const reason = observation ? await localSimulationReason(tx, latest, observation) : null;
      if (reason) return { rows: sourceRows.length, mapped: 0, review: sourceRows.length, mutated: false, simulated: configuration.source?.mode !== "GOOGLE", reconciliationRequired: true, reason };
      const mapped = await this.countSimulationRows(tx, row.id, configuration, sourceRows, values.columns);
      return { rows: sourceRows.length, mapped, review: sourceRows.length - mapped, mutated: false, simulated: configuration.source?.mode !== "GOOGLE", reconciliationRequired: false, reason: null };
    });
  }

  private async simulateAppend(actor: Principal, row: SheetImportConnector, configuration: SheetConfiguration): Promise<SimulationResult> {
    const values = await this.source.read(row.workbookId, row.tab, configuration), raw = values.observation;
    if (!raw || raw.sheetId !== configuration.source?.sheetId || raw.range !== configuration.source.range) throw new BadRequestException({ code: "sheet_append_observation_missing" });
    const observed = appendPositions(raw.range, raw.values);
    return this.repository.readTransaction(async (tx) => {
      const latest = await this.connector(tx, actor, row.id); if (latest.version !== row.version) throw new ConflictException({ code: "sheet_version_conflict" });
      const stream = await assertAppendBinding(tx, latest, configuration);
      const durable = await appendRows(tx, stream.id), earlier = new Map(durable.map((entry) => [entry.rowNumber, entry]));
      const reason = appendObservationConflict(stream, observed, durable), bad = reason !== null;
      const after = observed.positions.filter((position) => position.row > stream.contract.boundaryRow && !["CREATED", "DUPLICATE", "IGNORED", "REVIEW"].includes(earlier.get(position.row)?.status ?? ""));
      const rows = after.map((position) => Object.fromEntries(observed.header.map((column, index) => [column, position.cells[index] ?? ""])));
      const mapped = bad ? 0 : await this.countSimulationRows(tx, row.id, configuration, rows, observed.header);
      return { rows: rows.length, mapped, review: rows.length - mapped, mutated: false, simulated: configuration.source?.mode !== "GOOGLE", reconciliationRequired: bad, reason };
    });
  }

  private async countSimulationRows(tx: Prisma.TransactionClient, id: string, configuration: SheetConfiguration, rows: Record<string, string>[], columns: string[]): Promise<number> {
    let mapped = 0;
    for (const rawRow of rows) {
      const [record] = this.mappings.recordsFromSnapshot(configuration.mapping, { idempotencyKey: `simulation:${id}`, mappingKey: configuration.mapping.mappingKey,
        mappingVersion: configuration.mapping.version, rows: [rawRow], sourceColumns: columns, context: configuration.context, assignment: configuration.assignment });
      const local = configuration.source?.identityMode === "LOCAL_ROW" || configuration.source?.identityMode === APPEND_MODE;
      if (!hasSimulationFields(record, local)) continue;
      if (local && evaluateLocalMappedRow(record, rawRow, configuration.mapping)) continue;
      if (!await knownSimulationReferences(tx, record.campus, record.program, record.campaign, configuration.context.campus ?? "")) continue;
      mapped++;
    }
    return mapped;
  }

  async reconciliation(actor: Principal, id: string, page = 1): Promise<{ suspended: boolean; reason: string | null; page: number;
    rows: Array<{ rowNumber: number; status: string; errorCode: string | null; firstObservedAt: Date; lastObservedAt: Date }> }> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 200) throw new BadRequestException({ code: "sheet_history_page_invalid" });
    return this.repository.readTransaction(async (tx) => {
      const connector = await this.connector(tx, actor, id);
      const source = readSheetConfiguration(connector.configuration).source;
      if (source?.identityMode !== "LOCAL_ROW" || source.sheetId === undefined) return { suspended: false, reason: null, page, rows: [] };
      const stream = await tx.sheetLocalStream.findUnique({ where: { id: sheetStreamId(connector.workbookId, source.sheetId) } });
      if (!stream) return { suspended: false, reason: null, page, rows: [] };
      if (stream.campusId !== connector.campusId) throw new NotFoundException({ code: "sheet_connector_not_found" });
      const rows = await tx.sheetLocalRow.findMany({ where: { streamId: stream.id }, orderBy: { rowNumber: "asc" }, take: 50, skip: (page - 1) * 50,
        select: { rowNumber: true, status: true, errorCode: true, firstObservedAt: true, lastObservedAt: true } });
      return { suspended: stream.suspended, reason: stream.errorCode, page, rows };
    });
  }

  private async connector(tx: Prisma.TransactionClient, actor: Principal, id: string): Promise<SheetImportConnector> {
    const row = await tx.sheetImportConnector.findUnique({ where: { id: identifier(id) } });
    if (!row) throw new NotFoundException({ code: "sheet_connector_not_found" });
    try { await this.authorize(tx, actor, row.campusId, ["settings.campus.manage", "import.view"]); }
    catch (error) {
      if (error instanceof ForbiddenException) throw new NotFoundException({ code: "sheet_connector_not_found" });
      throw error;
    }
    return row;
  }
  private async authorize(tx: Prisma.TransactionClient, actor: Principal, campusId: string, keys: readonly string[]): Promise<Principal> {
    const current = await currentPrincipal(tx, actor);
    if (!current.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) permissionDenied();
    const campus = await canonicalCampus(tx, campusId);
    const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    const snapshots = await this.repository.snapshots(tx);
    if (!keys.every((key) => evaluatePermission(current, key, snapshots, context).allowed)) permissionDenied();
    return current;
  }
  private async audit(tx: Prisma.TransactionClient, actor: Principal, row: SheetImportConnector, eventType: string, after: Prisma.InputJsonObject): Promise<void> {
    await tx.auditEvent.create({ data: { actorId: actor.userId, actorRoles: actor.roles, campusId: row.campusId, resourceType: "SHEET_IMPORT", resourceId: row.id,
      eventType, result: "SUCCESS", after, correlationId: row.id, idempotencyKey: `sheet-admin:${randomUUID()}` } });
  }
}
