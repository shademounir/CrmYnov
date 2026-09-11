import { Inject, Injectable, HttpException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, SheetImportConnector, SheetLocalRow } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { acquirePermissionFence } from "../permissions/permission-fence.js";
import { ImportMappingService } from "../import-mapping/import-mapping.service.js";
import { PersistentIngestionService } from "../ingestion/persistent-ingestion.service.js";
import { SheetImportCoordinator, type SheetLease } from "./sheet-import-coordinator.js";
import { SheetSource } from "./synthetic-sheet-source.js";
import { ScheduledSheetExecutor } from "./sheet-import-scheduler.js";
import { readSheetConfiguration, sheetObject, sheetText, type SheetConfiguration } from "./sheet-import-configuration.js";
import { assertSheetAuthority } from "./sheet-import-authority.js";
import { classifySheetRow, sheetRowFingerprint, sheetRetry } from "./sheet-import-policy.js";
import { SheetsSourceError } from "./google-sheets-adapter.js";
import type { SheetValues } from "./google-sheets-adapter.js";
import { localObservation, observeLocalRow, sheetStreamId, verifyLocalLedger, suspendLocalStream } from "./sheet-local-ledger.js";
import { evaluateLocalMappedRow } from "./sheet-local-simulation.js";
import type { SheetLocalObservation, SheetObservedPosition } from "./sheet-local-observation.js";

type RunContext = { lease: SheetLease; configuration: SheetConfiguration; authorizedBy: string; campusId: string; workbookId: string; tab: string };
type LocalPositionInput = { streamId: string; position: SheetObservedPosition; row: Record<string, string>; columns: string[] };

function receiptOutcome(outcome: string): "CREATED" | "DUPLICATE" | "IGNORED" | "REVIEW" {
  if (outcome === "CREATED") return "CREATED";
  if (outcome === "ATTACHED") return "DUPLICATE";
  if (outcome === "IGNORED") return "IGNORED";
  return "REVIEW";
}

@Injectable()
export class SheetImportExecutor extends ScheduledSheetExecutor {
  private readonly coordinator: SheetImportCoordinator;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository,
    @Inject(ImportMappingService) private readonly mappings: ImportMappingService,
    @Inject(PersistentIngestionService) private readonly ingestion: PersistentIngestionService,
    @Inject(SheetSource) private readonly source: SheetSource) {
    super(); this.coordinator = new SheetImportCoordinator(prisma);
  }

  async execute(connectorId: string, trigger: "MANUAL" | "SCHEDULED"): Promise<void> {
    const claimed = await this.coordinator.claim(connectorId, trigger, (connector) => this.canProcess(connector));
    if (!claimed) return;
    try {
      if (process.env.FORMINATOR_WEBHOOK_ENABLED === "true") throw new Error("sheet_automatic_channel_active");
      const snapshot = sheetObject(claimed.run.configurationSnapshot);
      const context: RunContext = { lease: claimed.lease, configuration: readSheetConfiguration(snapshot.configuration),
        authorizedBy: sheetText(snapshot.authorizedBy), campusId: sheetText(snapshot.campusId),
        workbookId: sheetText(snapshot.workbookId), tab: sheetText(snapshot.tab) };
      await this.authorized(context, (): void => undefined);
      // All external I/O occurs outside PostgreSQL transactions and advisory locks.
      const values = await this.source.read(context.workbookId, context.tab, context.configuration);
      await this.coordinator.renew(context.lease);
      if (context.configuration.source?.identityMode === "LOCAL_ROW") {
        if (!await this.processLocal(context, values)) {
          await this.coordinator.finish(context.lease, "sheet_reconciliation_required");
          return;
        }
      } else {
        for (const row of values.rows) {
          await this.authorized(context, (tx) => this.processRow(tx, context, row, values.columns));
          await this.coordinator.renew(context.lease);
        }
      }
      await this.authorized(context, (): void => undefined);
      await this.coordinator.finish(context.lease);
    } catch (error) {
      const code = executionErrorCode(error);
      if (error instanceof SheetsSourceError) {
        const retry = sheetRetry(error.status, claimed.run.sourceFailures + 1, error.retryAfter, Date.now());
        if (retry.kind === "RETRY") { await this.coordinator.defer(claimed.lease, retry.delayMs, code); return; }
      }
      // If disabled or fenced out, the old worker must not overwrite the replacement run.
      await this.coordinator.finish(claimed.lease, code).catch(() => undefined);
      throw new Error(code);
    }
  }

  private canProcess(connector: SheetImportConnector): boolean {
    try {
      const configuration = readSheetConfiguration(connector.configuration);
      return this.source.canProcess?.(configuration) ?? true;
    } catch {
      // A malformed persisted snapshot is still claimed so the normal executor
      // records a controlled failure instead of leaving it due forever.
      return true;
    }
  }

  private async processLocal(context: RunContext, values: SheetValues): Promise<boolean> {
    const source = context.configuration.source;
    const raw = values.observation;
    if (!raw || raw.sheetId !== source?.sheetId || raw.range !== source.range) throw new Error("sheet_observation_missing");
    const observation = await this.readLocalObservation(context, raw);
    if (!observation) return false;
    const valid = await this.authorized(context, (tx) => verifyLocalLedger(tx, context.campusId, context.lease.connectorId, context.lease.runId, raw.range, observation));
    if (!valid) return false;
    const streamId = sheetStreamId(context.workbookId, raw.sheetId);
    for (const position of observation.positions) {
      const cells = raw.values[position.row - observation.scope.headerRow] ?? [];
      const row = Object.fromEntries(values.columns.map((column, index) => [column, cells[index] ?? ""]));
      await this.authorized(context, (tx) => this.processLocalPosition(tx, context, { streamId, position, row, columns: values.columns }));
      await this.coordinator.renew(context.lease);
    }
    return true;
  }

  private async readLocalObservation(context: RunContext, raw: NonNullable<SheetValues["observation"]>): Promise<SheetLocalObservation | null> {
    try { return localObservation(context.workbookId, raw.sheetId, raw.range, raw.values); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "sheet_local_headers_invalid") throw error;
      await this.authorized(context, (tx) => suspendLocalStream(tx, context.campusId, context.lease.connectorId, context.lease.runId,
        context.workbookId, raw.sheetId, raw.range, "headers_invalid"));
      return null;
    }
  }

  /** Runs inside the existing permission/lease-fenced transaction; never opens its own transaction. */
  private async processLocalPosition(tx: Prisma.TransactionClient, context: RunContext, input: LocalPositionInput): Promise<void> {
    const { streamId, position, row, columns } = input;
    const tracked = await observeLocalRow(tx, streamId, context.campusId, position.row, position.fingerprint, position.empty);
    const rowKey = createHash("sha256").update(`local:${tracked.id}`).digest("hex");
    if (await tx.sheetImportRunReceipt.findUnique({ where: { runId_rowKey: { runId: context.lease.runId, rowKey } } })) return;
    if (tracked.status !== "PENDING") {
      await this.recordPreviouslyObservedPosition(tx, context, rowKey, tracked);
      return;
    }
    const mapping = context.configuration.mapping;
    const [mapped] = this.mappings.recordsFromSnapshot(mapping, { idempotencyKey: context.lease.runId, mappingKey: mapping.mappingKey,
      mappingVersion: mapping.version, sourceColumns: columns, rows: [row], context: context.configuration.context, assignment: context.configuration.assignment });
    if (!mapped) throw new Error("sheet_record_missing");
    const issue = evaluateLocalMappedRow(mapped, row, mapping);
    if (issue) {
      await tx.sheetLocalRow.update({ where: { id: tracked.id }, data: { status: "REVIEW", errorCode: issue } });
      await this.receipt(tx, context, rowKey, "REVIEW", issue);
      return;
    }
    const record = { ...mapped, externalId: tracked.id, lineNumber: position.row, technicalSystem: "GOOGLE_SHEETS_LOCAL" };
    const result = await this.ingestion.persistSheetRecord(tx, context.lease.connectorId, record, mapping, context.lease.runId, context.configuration.assignment);
    const outcome = receiptOutcome(result.outcome);
    await tx.sheetLocalRow.update({ where: { id: tracked.id }, data: { status: outcome, batchId: result.batchId,
      errorCode: outcome === "REVIEW" ? "sheet_row_requires_review" : null } });
    await tx.sheetLocalStream.update({ where: { id: streamId }, data: { lastObservedRow: position.row } });
    await this.receipt(tx, context, rowKey, outcome, result.assignmentReason);
  }

  private async recordPreviouslyObservedPosition(tx: Prisma.TransactionClient, context: RunContext, rowKey: string, tracked: SheetLocalRow): Promise<void> {
    const outcome = tracked.status === "CREATED" || tracked.status === "DUPLICATE" ? "DUPLICATE" : "REVIEW";
    const reason = tracked.errorCode ?? (tracked.status === "EMPTY" ? "sheet_row_empty" : undefined);
    await this.receipt(tx, context, rowKey, outcome, reason);
  }

  private async authorized<T>(context: RunContext, action: (tx: Prisma.TransactionClient) => T | Promise<T>): Promise<T> {
    // Contact matching spans connectors and source identity modes. Retry only a fully
    // rolled-back serialization conflict; each attempt reacquires authority and
    // the lease. This callback performs database work only, never external I/O.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.authorizedTransaction(context, action); }
      catch (error) {
        if (attempt === 4 || !isSerializationConflict(error)) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, serializationRetryDelay(context, attempt)));
      }
    }
    throw new Error("sheet_transaction_conflict");
  }

  private async authorizedTransaction<T>(context: RunContext, action: (tx: Prisma.TransactionClient) => T | Promise<T>): Promise<T> {
    const client = this.prisma.client;
    if (!client) throw new Error("sheet_database_unavailable");
    return client.$transaction(async (tx): Promise<T> => {
      // Same ordering as HTTP: permission fence first, connector row second.
      await acquirePermissionFence(tx, "read-audited");
      return this.prisma.withTransaction(tx, () => this.coordinator.transaction(context.lease, async (joined): Promise<T> => {
        await assertSheetAuthority(joined, this.permissions, context.authorizedBy, context.campusId, context.configuration.assignment.strategy !== "UNASSIGNED");
        return action(joined);
      }));
    }, { timeout: 10_000, maxWait: 5_000, isolationLevel: "Serializable" });
  }

  private async processRow(tx: Prisma.TransactionClient, context: RunContext, row: Record<string, string>, columns: string[]): Promise<void> {
    const fingerprint = sheetRowFingerprint(row);
    const rowKey = createHash("sha256").update(fingerprint).digest("hex");
    if (await tx.sheetImportRunReceipt.findUnique({ where: { runId_rowKey: { runId: context.lease.runId, rowKey } } })) return;
    const mapping = context.configuration.mapping;
    const externalColumn = mapping.columns.find((column) => column.targetField === "externalId");
    const id = externalColumn ? row[externalColumn.sourceColumn]?.trim() : undefined;
    const previous = id && id.length <= 128 ? await tx.sheetImportSubmission.findUnique({ where: { connectorId_externalId: { connectorId: context.lease.connectorId, externalId: id } } }) : null;
    const decision = classifySheetRow(id, row, previous ? { externalId: previous.externalId, fingerprint: previous.fingerprint } : undefined);
    if (decision.kind !== "IMPORT") {
      await this.receipt(tx, context, rowKey, decision.kind === "REPLAY" ? "DUPLICATE" : "REVIEW", decision.kind === "REVIEW" ? decision.reason : undefined);
      return;
    }
    const [record] = this.mappings.recordsFromSnapshot(mapping, { idempotencyKey: context.lease.runId,
      mappingKey: mapping.mappingKey, mappingVersion: mapping.version, sourceColumns: columns, rows: [row],
      context: context.configuration.context, assignment: context.configuration.assignment });
    if (!record) throw new Error("sheet_record_missing");
    const result = await this.ingestion.persistSheetRecord(tx, context.lease.connectorId, record, mapping, context.lease.runId, context.configuration.assignment);
    await tx.sheetImportSubmission.create({ data: { connectorId: context.lease.connectorId, externalId: decision.externalId,
      fingerprint, outcome: result.outcome, batchId: result.batchId } });
    const outcome = receiptOutcome(result.outcome);
    await this.receipt(tx, context, rowKey, outcome, result.assignmentReason);
  }

  private async receipt(tx: Prisma.TransactionClient, context: RunContext, rowKey: string, outcome: "CREATED" | "DUPLICATE" | "IGNORED" | "REVIEW", reason?: string): Promise<void> {
    await tx.sheetImportRunReceipt.create({ data: { runId: context.lease.runId, rowKey, outcome, ...(reason ? { errorCode: reason } : {}) } });
    if (reason && outcome === "REVIEW") await tx.auditEvent.create({ data: { actorId: `SYSTEM:SHEETS:${context.lease.connectorId}`, actorRoles: ["SYSTEM"], campusId: context.campusId,
      eventType: "SHEET_IMPORT_ROW_REVIEWED", resourceType: "SHEET_IMPORT", resourceId: context.lease.connectorId, correlationId: context.lease.runId,
      result: "FAILED", after: { reason, outcome, configurationVersion: context.lease.version }, idempotencyKey: `sheet-review:${context.lease.runId}:${rowKey}` } });
    const field = { CREATED: "createdCount", DUPLICATE: "duplicateCount", IGNORED: "ignoredCount", REVIEW: "reviewCount" } as const;
    await tx.sheetImportRun.update({ where: { id: context.lease.runId }, data: { [field[outcome]]: { increment: 1 } } });
  }
}

function isSerializationConflict(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "P2034";
}

function serializationRetryDelay(context: RunContext, attempt: number): number {
  // Distinct connectors must not immediately collide again after PostgreSQL
  // aborts concurrent serializable transactions for the same contact.
  const digest = createHash("sha256").update(`${context.lease.connectorId}:${context.lease.runId}`).digest("hex");
  const jitter = Number.parseInt(digest.slice(0, 12), 16) % 251;
  return (2 ** attempt) * 10 + jitter;
}

function executionErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "object" && "code" in response && typeof response.code === "string" && /^[a-z_]{1,64}$/u.test(response.code)) return `sheet_${response.code}`;
  }
  if (error instanceof Error && /^sheet_[a-z_]{1,70}$/u.test(error.message)) return error.message;
  return "sheet_execution_failed";
}
