import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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
import { cutoverCounts, cutoverHash, cutoverInstant, cutoverInvalid, cutoverObject, cutoverRequest, cutoverSha, cutoverText, cutoverTimeZone, cutoverUuid,
  observeCutover, type CutoverContract, type CutoverEntry } from "./cutover.contract.js";
import { cutoverReplay, insertCutover, loadCutover, saveCutoverReceipt, updateCutover, type StoredCutover } from "./cutover.store.js";

function conflict(code: string): never { throw new ConflictException({ code }); }
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Preparation is separate from activation: no connector enabling, Lead effect or mail.
 * Source reads are split-phase; permissions and source bindings are rechecked after I/O. */
@Injectable()
export class CutoverService {
  constructor(@Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository,
    @Inject(BootstrapImportService) private readonly bootstrap: BootstrapImportService,
    @Inject(SheetSource) private readonly source: SheetSource) {}

  async create(raw: unknown, actor: Principal): Promise<unknown> {
    const body = cutoverObject(raw), bootstrapPackageId = cutoverUuid(body.bootstrapPackageId), connectorId = cutoverUuid(body.connectorId);
    const key = cutoverText(body.idempotencyKey), fingerprint = cutoverHash(body);
    const t0 = cutoverInstant(body.t0), excelFrozenAt = cutoverInstant(body.excelFrozenAt), timeZone = cutoverTimeZone(body.timeZone);
    if (excelFrozenAt > t0 || new Date(excelFrozenAt).valueOf() > Date.now()) cutoverInvalid("cutover_freeze_window_invalid");
    const originalArrivalColumn = cutoverText(body.originalArrivalColumn, 200), identityEvidenceSha256 = cutoverSha(body.identityEvidenceSha256);
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
        const replay = await cutoverReplay(tx, previous.id, "CREATE", key, fingerprint);
        if (replay !== undefined) return replay; conflict("cutover_already_bound");
      }
      const connector = await tx.sheetImportConnector.findUnique({ where: { id: connectorId } });
      if (!connector || connector.campusId !== pack.campusId) throw new NotFoundException({ code: "cutover_connector_not_found" });
      if (connector.enabled || connector.activeRunId || connector.manualRequested || connector.leaseUntil && connector.leaseUntil > new Date()) conflict("cutover_producer_must_be_stopped");
      if (!pack.sealedAt || !pack.snapshot) conflict("cutover_excel_snapshot_not_sealed");
      const configuration = readSheetConfiguration(connector.configuration);
      if (configuration.source?.identityMode !== "EXTERNAL_ID") conflict("cutover_durable_source_identity_required");
      const column = configuration.mapping.columns.filter((item) => item.targetField === "externalId");
      if (column.length !== 1 || !["DIRECT", "TRIM"].includes(column[0]!.action) || column[0]!.sourceColumn === originalArrivalColumn) conflict("cutover_external_identity_mapping_invalid");
      const contract: CutoverContract = { schemaVersion: 1, bootstrapPackageId, connectorId, excelSha256: pack.sha256,
        connectorVersion: connector.version, configurationSha256: cutoverHash(connector.configuration), t0, timeZone, equality: "POST_T0", excelFrozenAt,
        originalArrivalColumn, externalIdColumn: column[0]!.sourceColumn, identityEvidenceSha256 };
      const row = await insertCutover(tx, randomUUID(), pack.campusId, current.userId, contract);
      return this.record(tx, current, row, "CREATE", key, fingerprint, this.view(row));
    });
  }
  async get(id: string, actor: Principal): Promise<unknown> {
    cutoverUuid(id); return this.permissions.readTransaction(async (tx) => this.view(await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view"])));
  }
  async observe(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw);
    const preparation = await this.permissions.readTransaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.execute"]);
      await this.binding(tx, row);
      const replay = await cutoverReplay(tx, id, "OBSERVE", input.key, input.fingerprint); if (replay !== undefined) return { replay };
      this.expected(row, input.expectedVersion); this.available(row);
      const connector = await this.binding(tx, row);
      return { row, connector, configuration: readSheetConfiguration(connector.configuration) };
    });
    if ("replay" in preparation) return preparation.replay;
    const values = await this.source.read(preparation.connector.workbookId, preparation.connector.tab, preparation.configuration);
    const capturedAt = new Date();
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.execute"], true);
      await this.binding(tx, row);
      const replay = await cutoverReplay(tx, id, "OBSERVE", input.key, input.fingerprint); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); this.available(row); await this.binding(tx, row);
      const observed = observeCutover(row.contract, values, row.inventory, row.headerSha256 ?? undefined);
      const updated = await updateCutover(tx, row, { ...row, state: "BASELINED", inventory: observed.entries,
        headerSha256: observed.headerSha256, snapshotSha256: observed.snapshotSha256, observedAt: capturedAt, sourceCount: observed.sourceCount,
        reportSha256: null, suspensionReason: null });
      return this.record(tx, actor, updated, "OBSERVE", input.key, input.fingerprint, this.view(updated));
    });
  }
  async decide(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw), sourceKey = cutoverSha(input.body.sourceKey), reason = cutoverText(input.body.reason, 500);
    const action = input.body.action; if (action !== "KEEP_FOR_CATCHUP" && action !== "LINK_BASELINE") cutoverInvalid();
    const targetBootstrapRowId = action === "LINK_BASELINE" ? cutoverUuid(input.body.targetBootstrapRowId) : null;
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.review.resolve"], true);
      await this.binding(tx, row);
      const replay = await cutoverReplay(tx, id, "DECIDE", input.key, input.fingerprint); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); this.available(row); await this.binding(tx, row);
      if (!row.observedAt) conflict("cutover_baseline_missing");
      const source = row.inventory.find((entry) => entry.key === sourceKey);
      if (!source || source.classification !== "BACKLOG" || source.issue || source.decision) conflict("cutover_overlap_decision_invalid");
      if (targetBootstrapRowId) {
        const target = await tx.bootstrapImportRow.findUnique({ where: { id: targetBootstrapRowId } });
        if (!target || target.packageId !== row.bootstrapPackageId || target.state !== "ACCEPTED" || !target.leadId) conflict("cutover_baseline_target_invalid");
        await this.authorizeLead(tx, actor, target.leadId);
      }
      const inventory = row.inventory.map((entry): CutoverEntry => entry.key === sourceKey ? { ...entry, decision: action, targetBootstrapRowId } : entry);
      const updated = await updateCutover(tx, row, { ...row, inventory, state: "BASELINED", reportSha256: null });
      return this.record(tx, actor, updated, "DECIDE", input.key, input.fingerprint, { ...this.view(updated), decision: { sourceKey, action, targetBootstrapRowId, reason } });
    });
  }
  async reconcile(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw);
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.confirm"], true);
      await this.binding(tx, row);
      const replay = await cutoverReplay(tx, id, "RECONCILE", input.key, input.fingerprint); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); this.available(row); await this.binding(tx, row);
      if (!row.observedAt || !row.headerSha256 || !row.snapshotSha256) conflict("cutover_baseline_missing");
      const report = cutoverObject(await this.bootstrap.report(row.bootstrapPackageId, actor));
      const counts = cutoverCounts(row.inventory);
      if (report.cutoverBlocked !== false || counts.sourceIssues || counts.overlapReview) conflict("cutover_reconciliation_incomplete");
      for (const entry of row.inventory.filter((item) => item.targetBootstrapRowId)) {
        const target = await tx.bootstrapImportRow.findUnique({ where: { id: entry.targetBootstrapRowId! } });
        if (!target || target.packageId !== row.bootstrapPackageId || target.state !== "ACCEPTED" || !target.leadId) conflict("cutover_baseline_target_invalid");
        await this.authorizeLead(tx, actor, target.leadId);
      }
      const updated = await updateCutover(tx, row, { ...row, state: "READY_FOR_CATCHUP", reportSha256: cutoverHash(report) });
      return this.record(tx, actor, updated, "RECONCILE", input.key, input.fingerprint, this.view(updated));
    });
  }
  async suspend(id: string, raw: unknown, actor: Principal, resume = false): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw), reason = cutoverText(input.body.reason, 500), operation = resume ? "RESUME" : "SUSPEND";
    return this.permissions.transaction(async (tx) => {
      const row = await this.manifest(tx, id, actor, ["settings.campus.manage", "import.view", "import.confirm"], true);
      await this.binding(tx, row);
      const replay = await cutoverReplay(tx, id, operation, input.key, input.fingerprint); if (replay !== undefined) return replay;
      this.expected(row, input.expectedVersion); await this.binding(tx, row);
      if (resume && row.state !== "SUSPENDED" || !resume && row.state === "SUSPENDED") conflict("cutover_state_conflict");
      const updated = await updateCutover(tx, row, { ...row, state: resume ? "DRAFT" : "SUSPENDED", observedAt: resume ? null : row.observedAt,
        reportSha256: null, suspensionReason: resume ? null : reason });
      return this.record(tx, actor, updated, operation, input.key, input.fingerprint, { ...this.view(updated), reason });
    });
  }
  private async binding(tx: PermissionTransaction, row: StoredCutover): Promise<SheetImportConnector> {
    const connector = await tx.sheetImportConnector.findUnique({ where: { id: row.connectorId } });
    const pack = await tx.bootstrapImportPackage.findUnique({ where: { id: row.bootstrapPackageId } });
    if (!connector || !pack || connector.campusId !== row.campusId || pack.campusId !== row.campusId || pack.sha256 !== row.contract.excelSha256
      || connector.version !== row.contract.connectorVersion || cutoverHash(connector.configuration) !== row.contract.configurationSha256) conflict("cutover_binding_changed");
    if (connector.enabled || connector.activeRunId || connector.manualRequested || connector.leaseUntil && connector.leaseUntil > new Date()) conflict("cutover_producer_must_be_stopped");
    return connector;
  }
  private expected(row: StoredCutover, version: number): void { if (row.version !== version) conflict("cutover_version_conflict"); }
  private available(row: StoredCutover): void { if (row.state === "SUSPENDED") conflict("cutover_suspended"); }
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
  private async authorizeLead(tx: PermissionTransaction, actor: Principal, leadId: string): Promise<void> {
    const current = await currentPrincipal(tx, actor), context = await resourceEvaluationContext(tx, current, await leadResource(tx, leadId));
    if (!evaluatePermission(current, "lead.view", await this.permissions.snapshots(tx), context).allowed) permissionDenied();
  }
  private view(row: StoredCutover): Record<string, unknown> {
    return { id: row.id, campusId: row.campusId, state: row.state, version: row.version, contract: row.contract,
      counts: cutoverCounts(row.inventory), sourceCount: row.sourceCount, headerSha256: row.headerSha256, snapshotSha256: row.snapshotSha256,
      observedAt: row.observedAt?.toISOString() ?? null, reportSha256: row.reportSha256, suspensionReason: row.suspensionReason,
      captureWindow: { excelFrozenAt: row.contract.excelFrozenAt, sourceCapturedAt: row.observedAt?.toISOString() ?? null },
      localT0: new Intl.DateTimeFormat("fr-MA", { timeZone: row.contract.timeZone, dateStyle: "full", timeStyle: "long" }).format(new Date(row.contract.t0)),
      submissions: row.inventory.map(({ key, externalId, fingerprint, originalArrivedAt, classification, issue, decision, targetBootstrapRowId }) => ({ key, externalId, fingerprint, originalArrivedAt, classification, issue, decision, targetBootstrapRowId })),
      automaticActivationAvailable: false, effectsApplied: false, privateSourcePayloadOmitted: true,
      limitations: ["SOURCE_IDENTITY_EVIDENCE_DECLARED_NOT_UPSTREAM_ATTESTED", "CATCHUP_CONSUMER_NOT_IMPLEMENTED", "LOCAL_ROW_NOT_SUPPORTED", "SHEETS_REMAINS_DISABLED"] };
  }
  private async record(tx: PermissionTransaction, actor: Principal, row: StoredCutover, operation: string, key: string, fingerprint: string, response: unknown): Promise<unknown> {
    const current = await currentPrincipal(tx, actor);
    await saveCutoverReceipt(tx, row, operation, key, fingerprint, current.userId, response);
    await tx.auditEvent.create({ data: { actorId: current.userId, actorRoles: current.roles, campusId: row.campusId,
      eventType: `CUTOVER_${operation}`, resourceType: "IMPORT_CUTOVER", resourceId: row.id, result: "SUCCESS",
      correlationId: `cutover:${row.id}`, idempotencyKey: `cutover:${row.id}:${operation}:${cutoverHash(key)}`,
      after: json({ manifestId: row.id, state: row.state, version: row.version, counts: cutoverCounts(row.inventory), requestFingerprint: fingerprint }) } });
    return response;
  }
}
