import { ConflictException, HttpException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type SheetImportConnector } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { BootstrapImportService } from "../bootstrap-import/bootstrap-import.service.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { canonicalCampus, leadResource } from "../permissions/dynamic-resources.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../permissions/dynamic-repository.js";
import { readSheetConfiguration } from "../sheet-import/sheet-import-configuration.js";
import { SheetSource } from "../sheet-import/synthetic-sheet-source.js";
import { PersistentIngestionService } from "../ingestion/persistent-ingestion.service.js";
import { ImportMappingService } from "../import-mapping/import-mapping.service.js";
import { cutoverCounts, cutoverFinalFreeze, cutoverHash, cutoverInstant, cutoverInvalid, cutoverObject, cutoverRequest, cutoverSha, cutoverText, cutoverTimeZone, cutoverUuid,
  cutoverStreamKey, observeCutover, type CutoverContract, type CutoverEntry } from "./cutover.contract.js";
import { cutoverReplay, insertCutover, loadCutover, saveCutoverReceipt, updateCutover, type StoredCutover } from "./cutover.store.js";
import { cutoverDownstreamHash, cutoverEffects } from "./cutover.effects.js";
import { authorizeCutoverExceptionTargets, consumeCutover, cutoverBaselineTarget, cutoverBinding } from "./cutover-consumer.js";
import { assertCutoverExceptions, cutoverExceptionState, loadCutoverExceptionCase, observeCutoverExceptions, refreshCutoverExceptions, quarantineCutoverCase,
  CUTOVER_QUARANTINE_PAUSE, type CutoverExceptionCase, type CutoverExceptionState } from "./cutover-exceptions.js";

function conflict(code: string): never { throw new ConflictException({ code }); }
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Manual bounded catch-up is separate from automatic activation: no connector enabling or mail.
 * Source reads are split-phase; permissions and source bindings are rechecked after I/O. */
@Injectable()
export class CutoverService {
  constructor(@Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository,
    @Inject(BootstrapImportService) private readonly bootstrap: BootstrapImportService,
    @Inject(SheetSource) private readonly source: SheetSource,
    @Optional() @Inject(PersistentIngestionService) private readonly ingestion?: PersistentIngestionService,
    @Optional() @Inject(ImportMappingService) private readonly mappings?: ImportMappingService) {}

  async context(actor: Principal): Promise<unknown> {
    return this.permissions.readTransaction(async (tx) => {
      const current = await currentPrincipal(tx, actor);
      if (current.mustChangeSecret || !current.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role))) permissionDenied();
      const references = await tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE" }, orderBy: { label: "asc" }, take: 101 });
      if (references.length > 100) conflict("cutover_context_capacity_exceeded");
      const snapshots = await this.permissions.snapshots(tx), campuses = [];
      for (const reference of references) {
        const campus = await canonicalCampus(tx, reference.id), context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
        const allowed = (keys: string[]): boolean => keys.every((key) => evaluatePermission(current, key, snapshots, context).allowed);
        if (allowed(["settings.campus.manage", "import.view"])) campuses.push({ id: reference.id, label: reference.label, canCreate: allowed(["import.confirm"]) });
      }
      const rows = await tx.sheetImportConnector.findMany({ where: { campusId: { in: campuses.map((campus) => campus.id) } }, orderBy: { id: "asc" }, take: 101 });
      if (rows.length > 100) conflict("cutover_context_capacity_exceeded");
      return { campuses, connectors: rows.map((row) => { const config = readSheetConfiguration(row.configuration); return { id: row.id, campusId: row.campusId, label: row.tab,
        enabled: row.enabled, sourceSheetId: config.source?.sheetId ?? null, identityMode: config.source?.identityMode ?? null }; }), automaticActivationAvailable: false };
    });
  }

  async create(raw: unknown, actor: Principal): Promise<unknown> {
    const body = cutoverObject(raw), bootstrapPackageId = cutoverUuid(body.bootstrapPackageId), connectorId = cutoverUuid(body.connectorId);
    const key = cutoverText(body.idempotencyKey), fingerprint = cutoverHash(body);
    const t0 = cutoverInstant(body.t0), excelFrozenAt = cutoverInstant(body.excelFrozenAt), timeZone = cutoverTimeZone(body.timeZone);
    if (excelFrozenAt > t0 || new Date(excelFrozenAt).valueOf() > Date.now()) cutoverInvalid("cutover_freeze_window_invalid");
    cutoverFinalFreeze(excelFrozenAt, t0);
    const originalArrivalColumn = cutoverText(body.originalArrivalColumn, 200), identityEvidenceSha256 = cutoverSha(body.identityEvidenceSha256);
    const sourceSheetId = body.sourceSheetId; if (typeof sourceSheetId !== "number" || !Number.isSafeInteger(sourceSheetId) || sourceSheetId < 0) cutoverInvalid("cutover_sheet_identity_required");
    return this.permissions.transaction(async (tx) => {
      const pack = await tx.bootstrapImportPackage.findUnique({ where: { id: bootstrapPackageId } });
      if (!pack) throw new NotFoundException({ code: "cutover_package_not_found" });
      const current = await this.authorize(tx, actor, pack.campusId, ["settings.campus.manage", "import.view", "import.confirm"]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${connectorId},63))`;
      const existing = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM import_cutover_manifests WHERE connector_id=${connectorId}::uuid OR bootstrap_package_id=${bootstrapPackageId}::uuid`;
      if (existing[0]) {
        const previous = await loadCutover(tx, existing[0].id, true);
        if (previous.campusId !== pack.campusId || previous.connectorId !== connectorId || previous.bootstrapPackageId !== bootstrapPackageId) conflict("cutover_binding_conflict");
        await this.binding(tx, previous);
        const replay = await this.replay(tx, previous, "CREATE", key, fingerprint, actor);
        if (replay !== undefined) return replay; conflict("cutover_already_bound");
      }
      const connector = await tx.sheetImportConnector.findUnique({ where: { id: connectorId } });
      if (!connector || connector.campusId !== pack.campusId) throw new NotFoundException({ code: "cutover_connector_not_found" });
      if (connector.enabled || connector.activeRunId || connector.manualRequested || connector.leaseUntil && connector.leaseUntil > new Date()) conflict("cutover_producer_must_be_stopped");
      if (!pack.sealedAt || !pack.snapshot) conflict("cutover_excel_snapshot_not_sealed");
      const configuration = readSheetConfiguration(connector.configuration);
      if (configuration.source?.identityMode !== "EXTERNAL_ID") conflict("cutover_durable_source_identity_required");
      if (configuration.source.mode === "GOOGLE" && configuration.source.sheetId !== sourceSheetId) conflict("cutover_sheet_identity_mismatch");
      const streamKey = cutoverStreamKey(connector.workbookId, sourceSheetId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${streamKey},63))`;
      if ((await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM import_cutover_manifests WHERE stream_key=${streamKey}`).length) conflict("cutover_stream_already_bound");
      const column = configuration.mapping.columns.filter((item) => item.targetField === "externalId");
      if (column.length !== 1 || !["DIRECT", "TRIM"].includes(column[0]!.action) || column[0]!.sourceColumn === originalArrivalColumn) conflict("cutover_external_identity_mapping_invalid");
      const contract: CutoverContract = { schemaVersion: 2, streamKey, sourceSheetId, bootstrapPackageId, connectorId, excelSha256: pack.sha256,
        connectorVersion: connector.version, configurationSha256: cutoverHash(connector.configuration), t0, timeZone, equality: "POST_T0", excelFrozenAt,
        originalArrivalColumn, externalIdColumn: column[0]!.sourceColumn, identityEvidenceSha256 };
      const row = await insertCutover(tx, randomUUID(), pack.campusId, current.userId, contract);
      return this.record(tx, current, row, "CREATE", key, fingerprint, await this.view(tx, row, actor));
    });
  }
  async get(id: string, actor: Principal): Promise<unknown> {
    cutoverUuid(id); return this.permissions.readTransaction(async (tx) => this.view(tx, await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view"]), actor));
  }
  async observe(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw);
    const preparation = await this.permissions.readTransaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.execute"]);
      await this.binding(tx, row);
      const replay = await this.replay(tx, row, "OBSERVE", input.key, input.fingerprint, actor); if (replay !== undefined) return { replay };
      this.expected(row, input.expectedVersion); this.available(row, true);
      const connector = await this.binding(tx, row);
      return { row, connector, configuration: readSheetConfiguration(connector.configuration) };
    });
    if ("replay" in preparation) return preparation.replay;
    const values = await this.source.read(preparation.connector.workbookId, preparation.connector.tab, preparation.configuration);
    if (preparation.configuration.source?.mode === "GOOGLE" && values.observation?.sheetId !== preparation.row.contract.sourceSheetId) conflict("cutover_sheet_identity_mismatch");
    const capturedAt = new Date();
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.execute"], true);
      await this.binding(tx, row);
      const replay = await this.replay(tx, row, "OBSERVE", input.key, input.fingerprint, actor); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); this.available(row, true); await this.binding(tx, row);
      const observed = observeCutover(row.contract, values, row.inventory, row.headerSha256 ?? undefined);
      let updated = await updateCutover(tx, row, { ...row, state: "BASELINED", inventory: observed.entries,
        headerSha256: observed.headerSha256, snapshotSha256: observed.snapshotSha256, observedAt: capturedAt, sourceCount: observed.sourceCount,
        reportSha256: null, suspensionReason: null });
      updated = await observeCutoverExceptions(tx, updated, values);
      return this.record(tx, actor, updated, "OBSERVE", input.key, input.fingerprint, await this.view(tx, updated, actor));
    });
  }
  async decide(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw), sourceKey = cutoverSha(input.body.sourceKey), reason = cutoverText(input.body.reason, 500);
    const action = input.body.action; if (action !== "KEEP_FOR_CATCHUP" && action !== "LINK_BASELINE") cutoverInvalid();
    const targetBootstrapRowId = action === "LINK_BASELINE" ? cutoverUuid(input.body.targetBootstrapRowId) : null;
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.review.resolve"], true);
      await this.binding(tx, row);
      const replay = await this.replay(tx, row, "DECIDE", input.key, input.fingerprint, actor); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); this.available(row); await this.binding(tx, row);
      if (!row.observedAt) conflict("cutover_baseline_missing");
      const source = row.inventory.find((entry) => entry.key === sourceKey);
      if (!source || source.classification !== "BACKLOG" || source.issue || source.decision) conflict("cutover_overlap_decision_invalid");
      if (targetBootstrapRowId) {
        await this.authorizeLead(tx, actor, await cutoverBaselineTarget(tx, row, targetBootstrapRowId));
      }
      const inventory = row.inventory.map((entry): CutoverEntry => entry.key === sourceKey ? { ...entry, decision: action, targetBootstrapRowId } : entry);
      const updated = await updateCutover(tx, row, { ...row, inventory, state: "BASELINED", reportSha256: null });
      return this.record(tx, actor, updated, "DECIDE", input.key, input.fingerprint, { ...await this.view(tx, updated, actor), decision: { sourceKey, action, targetBootstrapRowId, reason } });
    });
  }
  async reconcile(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw);
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.confirm"], true);
      await this.binding(tx, row);
      cutoverFinalFreeze(row.contract.excelFrozenAt, row.contract.t0);
      const replay = await this.replay(tx, row, "RECONCILE", input.key, input.fingerprint, actor); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); this.available(row); await this.binding(tx, row);
      if (!row.observedAt || !row.headerSha256 || !row.snapshotSha256) conflict("cutover_baseline_missing");
      const report = cutoverObject(await this.bootstrap.report(row.bootstrapPackageId, actor));
      const exceptions = await assertCutoverExceptions(tx, row);
      await authorizeCutoverExceptionTargets(tx, row, exceptions.cases.map(({ item }) => item), (leadId) => this.authorizeLead(tx, actor, leadId));
      if (report.cutoverBlocked !== false || row.inventory.some((entry) => entry.classification === "BACKLOG" && !entry.decision && !exceptions.quarantinedKeys.has(entry.key))) conflict("cutover_reconciliation_incomplete");
      for (const entry of row.inventory.filter((item) => item.targetBootstrapRowId)) {
        await this.authorizeLead(tx, actor, await cutoverBaselineTarget(tx, row, entry.targetBootstrapRowId));
      }
      const updated = await updateCutover(tx, row, { ...row, state: "READY_FOR_CATCHUP", reportSha256: cutoverHash(report) });
      return this.record(tx, actor, updated, "RECONCILE", input.key, input.fingerprint, await this.view(tx, updated, actor));
    });
  }
  async suspend(id: string, raw: unknown, actor: Principal, resume = false): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw), reason = cutoverText(input.body.reason, 500), operation = resume ? "RESUME" : "SUSPEND";
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.confirm"], true);
      await this.binding(tx, row);
      const replay = await this.replay(tx, row, operation, input.key, input.fingerprint, actor); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); await this.binding(tx, row);
      if (resume && row.state !== "SUSPENDED" || !resume && row.state === "SUSPENDED") conflict("cutover_state_conflict");
      const updated = await updateCutover(tx, row, { ...row, state: resume ? "DRAFT" : "SUSPENDED", observedAt: resume ? null : row.observedAt,
        reportSha256: null, suspensionReason: resume ? null : reason });
      return this.record(tx, actor, updated, operation, input.key, input.fingerprint, { ...await this.view(tx, updated, actor), reason });
    });
  }
  async consume(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw), limit = input.body.limit;
    if (input.body.confirmed !== true || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 25) cutoverInvalid("cutover_manual_confirmation_required");
    if (!this.ingestion || !this.mappings) conflict("cutover_consumer_unavailable");
    const ingestion = this.ingestion, mappings = this.mappings;
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.execute", "import.confirm", "lead.create", "lead.view"], true);
      await this.binding(tx, row); const current = await currentPrincipal(tx, actor);
      cutoverFinalFreeze(row.contract.excelFrozenAt, row.contract.t0);
      const replay = await this.replay(tx, row, "CONSUME", input.key, input.fingerprint, actor); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); this.available(row);
      const processed = await consumeCutover(tx, row, limit, mappings, { report: () => this.bootstrap.report(row.bootstrapPackageId, actor),
        authorizeLead: (leadId) => this.authorizeLead(tx, actor, leadId),
        persist: (record, configuration, key, correlationId) => ingestion.persistCutoverRecord(tx, record, configuration.mapping, key, current, correlationId, configuration.assignment) });
      let updated = await updateCutover(tx, row, { ...row });
      updated = await refreshCutoverExceptions(tx, updated);
      if ((await cutoverExceptionState(tx, updated)).unresolvedCases) updated = await updateCutover(tx, updated, { ...updated, state: "BASELINED", reportSha256: null });
      return this.record(tx, actor, updated, "CONSUME", input.key, input.fingerprint, { ...await this.view(tx, updated, actor), processed });
    });
  }
  async exceptions(id: string, actor: Principal): Promise<unknown> {
    cutoverUuid(id); return this.permissions.readTransaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view"]);
      return this.exceptionView(tx, row, actor, await cutoverExceptionState(tx, row));
    });
  }
  async quarantine(id: string, caseId: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); cutoverUuid(caseId); const input = cutoverRequest(raw), evidenceSha256 = cutoverSha(input.body.evidenceSha256), reason = cutoverText(input.body.reason, 500);
    if (input.body.action !== "QUARANTINE_PRESERVE" || input.body.confirmed !== true || reason.length < 8) cutoverInvalid("cutover_quarantine_confirmation_required");
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.review.resolve", "import.confirm"], true);
      await this.binding(tx, row); const current = await currentPrincipal(tx, actor);
      const referencedCase = await loadCutoverExceptionCase(tx, id, caseId);
      if (referencedCase) await this.authorizeExceptionCase(tx, row, actor, referencedCase);
      const replay = await this.replay(tx, row, "QUARANTINE", input.key, cutoverHash({ ...input.body, caseId }), actor);
      if (replay !== undefined) {
        const receipt = cutoverObject(replay).receipt;
        return { ...await this.exceptionView(tx, row, actor, await cutoverExceptionState(tx, row)), receipt, replayed: true };
      }
      this.expected(row, input.expectedVersion);
      if (row.state === "SUSPENDED" && row.suspensionReason !== CUTOVER_QUARANTINE_PAUSE) conflict("cutover_suspended");
      const state = await cutoverExceptionState(tx, row), entry = state.cases.find(({ item }) => item.id === caseId);
      if (!state.coverageValid || !entry || entry.item.evidenceSha256 !== evidenceSha256) conflict("cutover_exception_evidence_changed");
      if (entry.disposition) conflict("cutover_exception_already_disposed");
      await this.authorizeExceptionCase(tx, row, actor, entry.item);
      const disposition = await quarantineCutoverCase(tx, row, entry.item, current.userId, reason);
      const updated = await updateCutover(tx, row, { ...row, state: "SUSPENDED", suspensionReason: CUTOVER_QUARANTINE_PAUSE, reportSha256: null });
      const receipt = { caseId, evidenceSha256, action: disposition.action, reason, actorId: current.userId, decidedAt: disposition.decidedAt.toISOString() };
      return this.record(tx, actor, updated, "QUARANTINE", input.key, cutoverHash({ ...input.body, caseId }),
        { ...await this.exceptionView(tx, updated, actor, await cutoverExceptionState(tx, updated)), receipt, replayed: false });
    });
  }
  async compensate(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw), sourceKey = cutoverSha(input.body.sourceKey), reason = cutoverText(input.body.reason, 500);
    if (input.body.confirmed !== true) cutoverInvalid("cutover_manual_confirmation_required");
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.confirm"], true);
      await this.binding(tx, row);
      const replay = await this.replay(tx, row, "COMPENSATE", input.key, input.fingerprint, actor); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion);
      const effect = (await cutoverEffects(tx, id)).find((item) => item.sourceKey === sourceKey);
      if (!effect || effect.outcome !== "CREATED" || !effect.leadId || effect.compensationStatus) conflict("cutover_compensation_target_invalid");
      await this.authorizeLead(tx, actor, effect.leadId, ["lead.view", "lead.edit"]);
      await tx.$queryRaw`SELECT id FROM leads WHERE id=${effect.leadId}::uuid FOR UPDATE`;
      const same = effect.downstreamSha256 !== null && await cutoverDownstreamHash(tx, effect.leadId) === effect.downstreamSha256;
      const status = same ? "REQUESTED" : "BLOCKED_DOWNSTREAM";
      await tx.$executeRaw`UPDATE import_cutover_effects SET compensation_status=${status},compensation_reason=${reason},compared_at=CURRENT_TIMESTAMP WHERE id=${effect.id}::uuid`;
      const updated = await updateCutover(tx, row, { ...row, state: "SUSPENDED", suspensionReason: "cutover_compensation_requires_controlled_forward_action", reportSha256: null });
      return this.record(tx, actor, updated, "COMPENSATE", input.key, input.fingerprint, { ...await this.view(tx, updated, actor),
        compensation: { sourceKey, status, applied: false, downstreamUnchanged: same, reason, limitation: "RECOVERABLE_WITHDRAWAL_NOT_IMPLEMENTED" } });
    });
  }
  private async binding(tx: PermissionTransaction, row: StoredCutover): Promise<SheetImportConnector> {
    return cutoverBinding(tx, row);
  }
  private expected(row: StoredCutover, version: number): void { if (row.version !== version) conflict("cutover_version_conflict"); }
  private available(row: StoredCutover, observing = false): void { if (row.state === "SUSPENDED" && !(observing && row.suspensionReason === CUTOVER_QUARANTINE_PAUSE)) conflict("cutover_suspended"); }
  private async manifest(tx: PermissionTransaction, id: string, actor: Principal, keys: string[], lock = false): Promise<StoredCutover> {
    const row = await loadCutover(tx, id, lock); await this.authorize(tx, actor, row.campusId, keys); return row;
  }
  private async authorize(tx: PermissionTransaction, actor: Principal, campusId: string, keys: string[]): Promise<Principal> {
    const current = await currentPrincipal(tx, actor), campus = await canonicalCampus(tx, campusId);
    if (current.mustChangeSecret || !current.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role))) permissionDenied();
    const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    const snapshots = await this.permissions.snapshots(tx);
    if (!keys.every((key) => evaluatePermission(current, key, snapshots, context).allowed)) permissionDenied(); return current;
  }
  private async authorizeLead(tx: PermissionTransaction, actor: Principal, leadId: string, keys = ["lead.view"]): Promise<void> {
    const current = await currentPrincipal(tx, actor), context = await resourceEvaluationContext(tx, current, await leadResource(tx, leadId));
    const snapshots = await this.permissions.snapshots(tx);
    if (!keys.every((key) => evaluatePermission(current, key, snapshots, context).allowed)) permissionDenied();
  }
  /** A receipt is an immutable result, not an authorization grant. Refuse its
   * replay if any previously visible Lead/BASELINE target is no longer readable. */
  private async replay(tx: PermissionTransaction, row: StoredCutover, operation: string, key: string, fingerprint: string, actor: Principal): Promise<unknown> {
    const replay = await cutoverReplay(tx, row.id, operation, key, fingerprint);
    if (replay === undefined) return undefined;
    const response = cutoverObject(replay), leadIds = new Set<string>(), targetIds = new Set<string>();
    for (const effect of Array.isArray(response.effects) ? response.effects : []) {
      const item = cutoverObject(effect); if (typeof item.leadId === "string") leadIds.add(item.leadId);
    }
    for (const submission of Array.isArray(response.submissions) ? response.submissions : []) {
      const item = cutoverObject(submission); if (typeof item.targetBootstrapRowId === "string") targetIds.add(item.targetBootstrapRowId);
    }
    if (response.decision) { const decision = cutoverObject(response.decision); if (typeof decision.targetBootstrapRowId === "string") targetIds.add(decision.targetBootstrapRowId); }
    for (const targetId of targetIds) {
      const target = await tx.bootstrapImportRow.findUnique({ where: { id: targetId } });
      if (!target || target.packageId !== row.bootstrapPackageId || !target.leadId) permissionDenied(); leadIds.add(target.leadId);
    }
    for (const leadId of leadIds) await this.authorizeLead(tx, actor, leadId);
    if (operation === "COMPENSATE") {
      const sourceKey = cutoverObject(response.compensation).sourceKey, effect = (await cutoverEffects(tx, row.id)).find((item) => item.sourceKey === sourceKey);
      if (!effect?.leadId) permissionDenied(); await this.authorizeLead(tx, actor, effect.leadId, ["lead.view", "lead.edit"]);
    }
    return { ...response, capabilities: (await this.view(tx, row, actor)).capabilities, bindingValid: true };
  }
  private async view(tx: PermissionTransaction, row: StoredCutover, actor: Principal): Promise<Record<string, unknown>> {
    const current = await currentPrincipal(tx, actor), campus = await canonicalCampus(tx, row.campusId), snapshots = await this.permissions.snapshots(tx);
    const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    const allowed = (keys: string[]): boolean => keys.every((key) => evaluatePermission(current, key, snapshots, context).allowed);
    let bindingValid = true;
    try { await this.binding(tx, row); } catch (error) { if (!(error instanceof ConflictException)) throw error; bindingValid = false; }
    const effects = await cutoverEffects(tx, row.id), visibleEffects = []; let compensable = false;
    for (const effect of effects) {
      let leadVisible = false;
      if (effect.leadId) { try { await this.authorizeLead(tx, actor, effect.leadId); leadVisible = true; } catch (error) { if (!(error instanceof HttpException && error.getStatus() === 403)) throw error; } }
      if (effect.leadId && effect.outcome === "CREATED" && !effect.compensationStatus) { try { await this.authorizeLead(tx, actor, effect.leadId, ["lead.view", "lead.edit"]); compensable = true; } catch (error) { if (!(error instanceof HttpException && error.getStatus() === 403)) throw error; } }
      visibleEffects.push({ id: effect.id, sourceKey: effect.sourceKey, outcome: effect.outcome, batchId: effect.batchId, reason: effect.reason,
        compensationStatus: effect.compensationStatus, compensationReason: effect.compensationReason, createdAt: effect.createdAt.toISOString(), comparedAt: effect.comparedAt?.toISOString() ?? null,
        ...(leadVisible ? { leadId: effect.leadId } : {}), leadVisible });
    }
    const exceptions = await cutoverExceptionState(tx, row);
    let exceptionTargetsVisible = true;
    for (const { item } of exceptions.cases) {
      try { await this.authorizeExceptionCase(tx, row, actor, item); }
      catch (error) { if (!(error instanceof HttpException && [403, 409].includes(error.getStatus()))) throw error; exceptionTargetsVisible = false; }
    }
    const done = new Set(effects.map((effect) => effect.sourceKey)), pending = row.inventory.filter((entry) => entry.classification === "BACKLOG" && !done.has(entry.key) && !exceptions.quarantinedKeys.has(entry.key)).length;
    const operational = bindingValid && row.state !== "SUSPENDED", freezeQualified = row.contract.excelFrozenAt === row.contract.t0;
    const capabilities = { canObserve: bindingValid && (operational || row.suspensionReason === CUTOVER_QUARANTINE_PAUSE) && allowed(["import.execute"]), canDecide: operational && !!row.observedAt && allowed(["import.review.resolve"]),
      canReconcile: operational && freezeQualified && !!row.observedAt && allowed(["import.confirm"]), canSuspend: operational && allowed(["import.confirm"]),
      canResume: bindingValid && row.state === "SUSPENDED" && allowed(["import.confirm"]),
      canConsume: operational && freezeQualified && exceptionTargetsVisible && exceptions.allDispositionsReconciled && row.state === "READY_FOR_CATCHUP" && row.contract.schemaVersion === 2 && allowed(["import.execute", "import.confirm", "lead.create", "lead.view"]),
      canCompensate: bindingValid && compensable && allowed(["import.confirm"]) };
    const submissions = [];
    for (const { key, externalId, fingerprint, originalArrivedAt, classification, issue, decision, targetBootstrapRowId } of row.inventory) {
      let visibleTarget: string | null = null;
      if (targetBootstrapRowId) { const target = await tx.bootstrapImportRow.findUnique({ where: { id: targetBootstrapRowId } });
        if (target?.leadId) { try { await this.authorizeLead(tx, actor, target.leadId); visibleTarget = targetBootstrapRowId; } catch (error) { if (!(error instanceof HttpException && error.getStatus() === 403)) throw error; } } }
      submissions.push({ key, externalId, fingerprint, originalArrivedAt, classification, issue, decision, targetBootstrapRowId: visibleTarget });
    }
    return { id: row.id, campusId: row.campusId, state: row.state, version: row.version, contract: row.contract,
      bindingValid, capabilities,
      counts: cutoverCounts(row.inventory), sourceCount: row.sourceCount, headerSha256: row.headerSha256, snapshotSha256: row.snapshotSha256,
      observedAt: row.observedAt?.toISOString() ?? null, reportSha256: row.reportSha256, suspensionReason: row.suspensionReason,
      captureWindow: { excelFrozenAt: row.contract.excelFrozenAt, sourceCapturedAt: row.observedAt?.toISOString() ?? null },
      localT0: new Intl.DateTimeFormat("fr-MA", { timeZone: row.contract.timeZone, dateStyle: "full", timeStyle: "long" }).format(new Date(row.contract.t0)),
      submissions,
      effects: visibleEffects, catchup: { total: effects.length, created: effects.filter((effect) => effect.outcome === "CREATED").length, linkedBaseline: effects.filter((effect) => effect.outcome === "LINKED_BASELINE").length,
        review: effects.filter((effect) => effect.outcome === "REVIEW").length, quarantined: exceptions.quarantinedKeys.size,
        allDispositionsReconciled: bindingValid && exceptionTargetsVisible && row.state === "READY_FOR_CATCHUP" && exceptions.allDispositionsReconciled,
        pending, complete: bindingValid && freezeQualified && exceptionTargetsVisible && exceptions.allDispositionsReconciled && exceptions.quarantinedKeys.size === 0 && row.state === "READY_FOR_CATCHUP" && pending === 0 && effects.every((effect) => effect.outcome !== "REVIEW" && !effect.compensationStatus) },
      automaticActivationAvailable: false, effectsApplied: effects.some((effect) => effect.outcome === "CREATED"), compensationApplied: false, privateSourcePayloadOmitted: true,
      limitations: ["SOURCE_IDENTITY_EVIDENCE_DECLARED_NOT_UPSTREAM_ATTESTED", "AUTOMATIC_CATCHUP_NOT_IMPLEMENTED", "RECOVERABLE_COMPENSATION_NOT_IMPLEMENTED", "LOCAL_ROW_NOT_SUPPORTED", "SHEETS_REMAINS_DISABLED"] };
  }
  private async exceptionView(tx: PermissionTransaction, row: StoredCutover, actor: Principal, state: CutoverExceptionState): Promise<Record<string, unknown>> {
    const current = await currentPrincipal(tx, actor), campus = await canonicalCampus(tx, row.campusId), snapshots = await this.permissions.snapshots(tx);
    const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    const allowed = (keys: string[]): boolean => keys.every((key) => evaluatePermission(current, key, snapshots, context).allowed);
    let bindingValid = true; try { await this.binding(tx, row); } catch (error) { if (!(error instanceof ConflictException)) throw error; bindingValid = false; }
    for (const { item } of state.cases) await this.authorizeExceptionCase(tx, row, actor, item);
    const observation = state.observation;
    return { id: row.id, version: row.version, state: row.state, bindingValid,
      observation: observation ? { sourceEvidenceSha256: observation.sourceEvidenceSha256, bindingSha256: observation.bindingSha256, headerSha256: observation.headerSha256,
        observedAt: observation.observedAt, observedManifestVersion: observation.observedManifestVersion } : null,
      cases: state.cases.map(({ item, disposition, requiresReobservation }) => ({ id: item.id, sourceKey: item.sourceKey, kind: item.kind, generation: item.generation,
        evidenceSha256: item.evidenceSha256, present: item.evidence.source.present, originalFingerprint: item.evidence.originalFingerprint,
        observedFingerprint: item.evidence.source.fingerprint, observedOriginalArrivedAt: item.evidence.source.originalArrivedAt,
        effectId: item.evidence.review?.effectId ?? null, batchId: item.evidence.review?.batchId ?? null, reasonCode: item.evidence.review?.reason ?? null,
        disposition: disposition ? { action: disposition.action, reason: disposition.reason, actorId: disposition.actorId, decidedAt: disposition.decidedAt.toISOString(), decidedManifestVersion: disposition.decidedManifestVersion } : null,
        current: true, requiresReobservation })),
      summary: { coverageValid: state.coverageValid, currentCases: state.expectedCases, unresolvedCases: state.unresolvedCases, quarantinedCases: state.quarantinedCases,
        uniqueQuarantinedSources: state.quarantinedKeys.size, requiresReobservation: state.requiresReobservation,
        allDispositionsReconciled: bindingValid && row.state === "READY_FOR_CATCHUP" && state.allDispositionsReconciled },
      capabilities: { canQuarantine: bindingValid && state.coverageValid && state.unresolvedCases > 0 && (row.state !== "SUSPENDED" || row.suspensionReason === CUTOVER_QUARANTINE_PAUSE)
          && allowed(["import.review.resolve", "import.confirm"]),
        canObserve: bindingValid && (row.state !== "SUSPENDED" || row.suspensionReason === CUTOVER_QUARANTINE_PAUSE) && allowed(["import.execute"]) },
      privateSourcePayloadOmitted: true, quarantineIsNotIngestion: true, effectsPreserved: true };
  }
  private async authorizeExceptionCase(tx: PermissionTransaction, row: StoredCutover, actor: Principal, item: CutoverExceptionCase): Promise<void> {
    await authorizeCutoverExceptionTargets(tx, row, [item], (leadId) => this.authorizeLead(tx, actor, leadId));
  }
  private async record(tx: PermissionTransaction, actor: Principal, row: StoredCutover, operation: string, key: string, fingerprint: string, response: unknown): Promise<unknown> {
    const current = await currentPrincipal(tx, actor);
    await saveCutoverReceipt(tx, row, operation, key, fingerprint, current.userId, response);
    await tx.auditEvent.create({ data: { actorId: current.userId, actorRoles: current.roles, campusId: row.campusId,
      eventType: `CUTOVER_${operation}`, resourceType: "IMPORT_CUTOVER", resourceId: row.id, result: "SUCCESS",
      correlationId: `cutover:${row.id}`, idempotencyKey: `cutover:${row.id}:${operation}:${cutoverHash(key)}`,
      after: json({ manifestId: row.id, state: row.state, version: row.version, counts: cutoverCounts(row.inventory), requestFingerprint: fingerprint,
        sourceEvidenceSha256: row.exceptionObservation?.sourceEvidenceSha256 ?? null, exceptionCaseIds: row.exceptionObservation?.cases.map((item) => item.caseId) ?? [] }) } });
    return response;
  }
}
