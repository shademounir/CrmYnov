import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma, SheetImportConnector } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { ImportMappingService, type ImportMappingTemplate } from "../import-mapping/import-mapping.service.js";
import { validateLeadReferences } from "../references/reference.repository.js";
import { readSheetConfiguration, sheetObject, sheetText, type SheetConfiguration } from "./sheet-import-configuration.js";
import { workbookId } from "./google-sheets-adapter.js";
import { sheetInterval } from "./sheet-import-policy.js";
import { assertSheetAuthority } from "./sheet-import-authority.js";
import { SheetSource } from "./synthetic-sheet-source.js";

type ConnectorView = Pick<SheetImportConnector, "id" | "campusId" | "workbookId" | "tab" | "enabled" | "intervalMinutes" | "version" | "nextRunAt" | "manualRequested"> & { configuration: SheetConfiguration; simulated: true };
function view(row: SheetImportConnector): ConnectorView {
  return { id: row.id, campusId: row.campusId, workbookId: row.workbookId, tab: row.tab, enabled: row.enabled,
    intervalMinutes: row.intervalMinutes, version: row.version, nextRunAt: row.nextRunAt, manualRequested: row.manualRequested,
    configuration: readSheetConfiguration(row.configuration), simulated: true };
}
function configurationJson(value: SheetConfiguration): Prisma.InputJsonObject {
  return { mapping: { ...value.mapping, columns: value.mapping.columns.map((column) => ({ ...column })) }, context: { ...value.context }, assignment: { ...value.assignment } };
}
function identifier(value: string): string {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu.test(value)) throw new BadRequestException({ code: "sheet_identifier_invalid" });
  return value;
}

@Injectable()
export class SheetImportAdminService {
  constructor(@Inject(DynamicPermissionRepository) private readonly repository: DynamicPermissionRepository,
    @Inject(ImportMappingService) private readonly mappings: ImportMappingService, @Inject(SheetSource) private readonly source: SheetSource) {}

  async list(actor: Principal, campusValue: string): Promise<{ connectors: ConnectorView[]; mappings: ImportMappingTemplate[]; simulated: true }> {
    return this.repository.readTransaction(async (tx) => {
      const campus = await canonicalCampus(tx, sheetText(campusValue));
      const current = await this.authorize(tx, actor, campus.id, ["settings.campus.manage", "import.view"]);
      const rows = await tx.sheetImportConnector.findMany({ where: { campusId: campus.id }, orderBy: { id: "asc" }, take: 100 });
      return { connectors: rows.map(view), mappings: this.mappings.list(current).filter((mapping) => mapping.profile === "FORMINATOR_ZAPIER"), simulated: true };
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
    if (!workbook.startsWith("synthetic_")) throw new BadRequestException({ code: "sheet_real_source_disabled" });
    return this.repository.transaction(async (tx) => {
      const campus = await canonicalCampus(tx, sheetText(body.campusId));
      const current = await this.authorize(tx, actor, campus.id, ["settings.campus.manage"]);
      const previous = id ? await this.connector(tx, current, id) : null;
      if ((previous?.version ?? 0) !== expected || previous && previous.campusId !== campus.id) throw new ConflictException({ code: "sheet_version_conflict" });
      if (body.enabled && previous?.leaseUntil && previous.leaseUntil > new Date()) throw new ConflictException({ code: "sheet_execution_active" });
      const template = sheetObject(body.mapping);
      const parsed = readSheetConfiguration({ mapping: { ...template, id: "pending", version: expected + 1, createdBy: current.userId, createdAt: new Date().toISOString() },
        context: body.context, assignment: body.assignment });
      const configuration: SheetConfiguration = { ...parsed, mapping: this.mappings.snapshot({ ...parsed.mapping, expectedVersion: expected }, current.userId, new Date().toISOString()) };
      const reference = await tx.crmReference.findUniqueOrThrow({ where: { id: campus.id } });
      if (configuration.context.campus !== reference.code) throw new BadRequestException({ code: "sheet_campus_mapping_invalid" });
      const enabled = body.enabled === true;
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

  private async authorizeActivation(tx: Prisma.TransactionClient, userId: string, campusId: string, configuration: SheetConfiguration, id?: string): Promise<void> {
    if (process.env.FORMINATOR_WEBHOOK_ENABLED === "true") throw new ConflictException({ code: "sheet_automatic_channel_active" });
    await assertSheetAuthority(tx, this.repository, userId, campusId, configuration.assignment.strategy !== "UNASSIGNED");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, 1)`;
    if (await tx.sheetImportConnector.count({ where: { enabled: true, ...(id ? { id: { not: id } } : {}) } })) throw new ConflictException({ code: "sheet_automatic_channel_active" });
  }

  async requestRun(actor: Principal, id: string, expectedVersion: number): Promise<{ queued: true; version: number }> {
    return this.repository.transaction(async (tx) => {
      const row = await this.connector(tx, actor, id);
      if (!row.enabled || row.version !== expectedVersion) throw new ConflictException({ code: "sheet_disabled_or_version_conflict" });
      await assertSheetAuthority(tx, this.repository, row.updatedBy, row.campusId, readSheetConfiguration(row.configuration).assignment.strategy !== "UNASSIGNED");
      const current = await this.authorize(tx, actor, row.campusId, ["settings.campus.manage", "import.execute", "import.confirm"]);
      if (row.activeRunId || row.manualRequested) throw new ConflictException({ code: "sheet_execution_active" });
      await tx.sheetImportConnector.update({ where: { id: row.id, version: expectedVersion }, data: { nextRunAt: new Date(), manualRequested: true } });
      await this.audit(tx, current, row, "SHEET_IMPORT_REQUESTED", { version: row.version });
      return { queued: true, version: row.version };
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

  async simulate(actor: Principal, id: string): Promise<{ rows: number; mapped: number; review: number; mutated: false; simulated: true }> {
    const row = await this.repository.readTransaction((tx) => this.connector(tx, actor, id));
    const configuration = readSheetConfiguration(row.configuration);
    const values = await this.source.read(row.workbookId, row.tab, configuration);
    return this.repository.transaction(async (tx) => {
      const latest = await this.connector(tx, actor, id);
      if (latest.version !== row.version) throw new ConflictException({ code: "sheet_version_conflict" });
      let mapped = 0;
      for (const rawRow of values.rows) {
        const [record] = this.mappings.recordsFromSnapshot(configuration.mapping, { idempotencyKey: `simulation:${row.id}`, mappingKey: configuration.mapping.mappingKey,
          mappingVersion: configuration.mapping.version, rows: [rawRow], sourceColumns: values.columns, context: configuration.context, assignment: configuration.assignment });
        if (!record?.externalId || !record.campus || !record.program || !record.campaign) continue;
        await validateLeadReferences(tx, { campus: record.campus, program: record.program, campaign: record.campaign });
        mapped++;
      }
      return { rows: values.rows.length, mapped, review: values.rows.length - mapped, mutated: false, simulated: true };
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
