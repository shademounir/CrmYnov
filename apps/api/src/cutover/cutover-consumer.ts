import { ConflictException } from "@nestjs/common";
import type { SheetImportConnector } from "@prisma/client";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import type { ImportMappingService } from "../import-mapping/import-mapping.service.js";
import type { IngestionRecordInput } from "../ingestion/ingestion.service.js";
import type { SheetConfiguration } from "../sheet-import/sheet-import-configuration.js";
import { readSheetConfiguration } from "../sheet-import/sheet-import-configuration.js";
import { cutoverCounts, cutoverFinalFreeze, cutoverHash, cutoverObject } from "./cutover.contract.js";
import { cutoverDownstreamHash, cutoverEffects, saveCutoverEffect } from "./cutover.effects.js";
import { loadCutover, type StoredCutover } from "./cutover.store.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";

function conflict(code: string): never { throw new ConflictException({ code }); }
export async function cutoverBinding(tx: PermissionTransaction, row: StoredCutover): Promise<SheetImportConnector> {
  const connector = await tx.sheetImportConnector.findUnique({ where: { id: row.connectorId } });
  const pack = await tx.bootstrapImportPackage.findUnique({ where: { id: row.bootstrapPackageId } });
  if (!connector || !pack || connector.campusId !== row.campusId || pack.campusId !== row.campusId || pack.sha256 !== row.contract.excelSha256
    || connector.version !== row.contract.connectorVersion || cutoverHash(connector.configuration) !== row.contract.configurationSha256) conflict("cutover_binding_changed");
  if (connector.enabled || connector.activeRunId || connector.manualRequested || connector.leaseUntil && connector.leaseUntil > new Date()) conflict("cutover_producer_must_be_stopped");
  return connector;
}
export interface CutoverConsumerAuthority {
  report(): Promise<unknown>;
  authorizeLead(leadId: string): Promise<void>;
  persist(record: IngestionRecordInput, configuration: SheetConfiguration, key: string, correlationId: string): Promise<{ batchId: string; outcome: string; leadId?: string; reason?: string }>;
}
/** A historical ledger target is not a permanent grant to a moved dossier. */
export async function cutoverBaselineTarget(tx: PermissionTransaction, row: StoredCutover, targetId: string | null | undefined): Promise<string> {
  const target = targetId ? await tx.bootstrapImportRow.findUnique({ where: { id: targetId } }) : null;
  if (!target || target.packageId !== row.bootstrapPackageId || target.state !== "ACCEPTED" || !target.leadId) conflict("cutover_baseline_target_invalid");
  const lead = await tx.lead.findUnique({ where: { id: target.leadId }, select: { campus: true } });
  if (!lead) conflict("cutover_baseline_target_invalid");
  if ((await canonicalCampus(tx, lead.campus)).id !== row.campusId) conflict("cutover_baseline_campus_mismatch");
  return target.leadId;
}
/** Caller owns the permission fence and manifest lock. All effects/reconciliation
 * are one transaction; authority differs, durable identities/keys never do. */
export async function consumeCutover(tx: PermissionTransaction, row: StoredCutover, limit: number, mappings: ImportMappingService, authority: CutoverConsumerAuthority): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) conflict("cutover_chunk_invalid");
  const connector = await cutoverBinding(tx, row);
  cutoverFinalFreeze(row.contract.excelFrozenAt, row.contract.t0);
  if (row.contract.schemaVersion !== 2 || !row.contract.streamKey || row.contract.sourceSheetId === undefined) conflict("cutover_durable_stream_upgrade_required");
  if (row.state !== "READY_FOR_CATCHUP" || !row.reportSha256 || !row.observedAt) conflict("cutover_reconciliation_required");
  const report = cutoverObject(await authority.report());
  if (report.cutoverBlocked !== false || cutoverHash(report) !== row.reportSha256) conflict("cutover_reconciliation_required");
  const counts = cutoverCounts(row.inventory); if (counts.sourceIssues || counts.overlapReview) conflict("cutover_reconciliation_incomplete");
  const existing = new Set((await cutoverEffects(tx, row.id)).map((effect) => effect.sourceKey));
  const pending = row.inventory.filter((entry) => entry.classification === "BACKLOG" && !existing.has(entry.key)).slice(0, limit);
  const configuration = readSheetConfiguration(connector.configuration), sourceColumns = configuration.mapping.columns.map((column) => column.sourceColumn);
  if (cutoverHash(sourceColumns) !== row.headerSha256) conflict("cutover_mapping_headers_mismatch");
  for (const entry of pending) {
    if (entry.decision === "LINK_BASELINE") {
      const leadId = await cutoverBaselineTarget(tx, row, entry.targetBootstrapRowId);
      await authority.authorizeLead(leadId);
      await saveCutoverEffect(tx, { manifestId: row.id, sourceKey: entry.key, outcome: "LINKED_BASELINE", leadId, batchId: null, reason: null, downstreamSha256: null });
      continue;
    }
    if (entry.decision !== "KEEP_FOR_CATCHUP") conflict("cutover_overlap_decision_invalid");
    const [mapped] = mappings.recordsFromSnapshot(configuration.mapping, { idempotencyKey: `cutover:${entry.key}`, mappingKey: configuration.mapping.mappingKey,
      mappingVersion: configuration.mapping.version, rows: [entry.payload], sourceColumns, context: configuration.context, assignment: configuration.assignment });
    if (!mapped) conflict("cutover_mapping_record_missing");
    // A per-cell campus overrides mapping context; even a GLOBAL actor must not
    // write outside the campus durably bound to this manifest and its ledger.
    if ((await canonicalCampus(tx, mapped.campus ?? "")).id !== row.campusId) conflict("cutover_record_campus_mismatch");
    const result = await authority.persist({ ...mapped, lineNumber: 1, externalId: `cutover:${entry.key}`, occurredAt: entry.originalArrivedAt }, configuration,
      `cutover-ingest:${entry.key}`, `c63:${cutoverHash([row.id, entry.key]).slice(0, 40)}`);
    if (result.leadId) await authority.authorizeLead(result.leadId);
    const outcome = result.outcome === "CREATED" ? "CREATED" : "REVIEW";
    if (outcome === "CREATED" && (!result.leadId || (await tx.lead.findUniqueOrThrow({ where: { id: result.leadId } })).acquisitionKind !== "NEW")) conflict("cutover_new_effect_required");
    await saveCutoverEffect(tx, { manifestId: row.id, sourceKey: entry.key, outcome, batchId: result.batchId, leadId: result.leadId ?? null,
      reason: result.reason ?? null, downstreamSha256: outcome === "CREATED" && result.leadId ? await cutoverDownstreamHash(tx, result.leadId) : null });
  }
  return pending.length;
}
export async function lockedCutoverBinding(tx: PermissionTransaction, id: string): Promise<{ row: StoredCutover; connector: SheetImportConnector }> {
  const row = await loadCutover(tx, id, true); return { row, connector: await cutoverBinding(tx, row) };
}
