import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { BootstrapImportService } from "../bootstrap-import/bootstrap-import.service.js";
import { ImportMappingService } from "../import-mapping/import-mapping.service.js";
import { PersistentIngestionService } from "../ingestion/persistent-ingestion.service.js";
import { currentPrincipal, permissionDenied } from "../permissions/dynamic-context.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../permissions/dynamic-repository.js";
import { readSheetConfiguration } from "../sheet-import/sheet-import-configuration.js";
import { SheetSource } from "../sheet-import/synthetic-sheet-source.js";
import { cutoverCounts, cutoverFinalFreeze, cutoverHash, cutoverInvalid, cutoverObject, cutoverRequest, cutoverUuid, observeCutover } from "./cutover.contract.js";
import { consumeCutover, cutoverBinding } from "./cutover-consumer.js";
import { assertCutoverRuntimeAuthority, assertCutoverRuntimeLead, type CutoverDelegation, type CutoverRuntimeAuthority } from "./cutover-runtime-authority.js";
import { loadCutover, updateCutover, type StoredCutover } from "./cutover.store.js";
import { loadCutoverRuntime, runtimeBindingHash, runtimeReceipt, runtimeReplay, type CutoverQualification, type StoredCutoverRuntime } from "./cutover-runtime.store.js";

function conflict(code: string): never { throw new ConflictException({ code }); }
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const LEASE_MS = 60000, SOURCE_TIMEOUT_MS = 30000;
export const cutoverWorkerEnabled = (env: Readonly<Record<string, string | undefined>>): boolean => env.SHEETS_ENABLED === "true" && env.SHEET_CUTOVER_ENABLED === "true";
export function cutoverRuntimeError(error: unknown): string {
  if (error instanceof HttpException) {
    const code = cutoverObject(error.getResponse()).code;
    if (typeof code === "string" && /^[a-z0-9_]{1,128}$/u.test(code)) return code;
  }
  return "cutover_runtime_operation_failed";
}
/** Provider fixture arm is impossible on a real/shared database, even when both
 * flags are accidentally enabled. Real Google qualification is not implemented. */
export async function assertCutoverFixtureDatabase(tx: PermissionTransaction): Promise<void> {
  let database: URL; try { database = new URL(process.env.DATABASE_URL ?? ""); } catch { conflict("cutover_fixture_database_required"); }
  if (process.env.CRMY63_EPHEMERAL_TEST !== "true" || !process.env.CRMY63_DATABASE_NONCE || !["127.0.0.1", "localhost"].includes(database.hostname)
    || database.pathname !== "/crmy63_cutover_synthetic") conflict("cutover_fixture_database_required");
  const exists = await tx.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('crmy63_test_identity.marker')::text AS name`;
  if (!exists[0]?.name) conflict("cutover_fixture_database_required");
  const marker = await tx.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy63_test_identity.marker WHERE purpose='cutover-synthetic-qualification'`;
  if (!marker.some((item) => item.nonce === process.env.CRMY63_DATABASE_NONCE)) conflict("cutover_fixture_database_required");
}
interface Claim { id: string; runId: string; owner: string; epoch: number; version: number; manifestVersion: number; }
@Injectable()
export class CutoverRuntimeService {
  constructor(@Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository,
    @Inject(BootstrapImportService) private readonly bootstrap: BootstrapImportService,
    @Inject(PersistentIngestionService) private readonly ingestion: PersistentIngestionService,
    @Inject(ImportMappingService) private readonly mappings: ImportMappingService,
    @Inject(SheetSource) private readonly source: SheetSource) {}

  async get(id: string, actor: Principal): Promise<unknown> {
    cutoverUuid(id); return this.permissions.readTransaction(async (tx) => {
      const row = await loadCutover(tx, id); await this.manualAuthority(tx, row, actor);
      const runtime = await loadCutoverRuntime(tx, id);
      return runtime ? this.view(runtime) : { state: "UNQUALIFIED", automaticActivationAvailable: false, googleQualification: "PREPARATION_ONLY" };
    });
  }
  async qualify(id: string, raw: unknown, actor: Principal): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw);
    return this.permissions.transaction(async (tx) => {
      const row = await loadCutover(tx, id, true), authority = await this.manualAuthority(tx, row, actor), connector = await cutoverBinding(tx, row);
      cutoverFinalFreeze(row.contract.excelFrozenAt, row.contract.t0);
      const previous = await loadCutoverRuntime(tx, id, true), replay = await runtimeReplay(tx, id, "QUALIFY", input.key, input.fingerprint);
      if (replay !== undefined) return this.view(previous!);
      if (row.version !== input.expectedVersion) conflict("cutover_version_conflict");
      if (previous?.state === "ARMED" || previous?.leaseUntil && previous.leaseUntil > new Date()) conflict("cutover_runtime_must_be_disarmed");
      const configuration = readSheetConfiguration(connector.configuration);
      const artifact = this.source.cutoverFixtureArtifact?.(configuration);
      if (configuration.source?.mode !== "SIMULATED" || !/^synthetic_[a-z0-9_-]{1,60}$/u.test(connector.workbookId) || !artifact) conflict("cutover_upstream_not_qualified");
      await assertCutoverFixtureDatabase(tx);
      await this.ready(tx, row, authority);
      if (cutoverHash(configuration.mapping.columns.map((column) => column.sourceColumn)) !== row.headerSha256) conflict("cutover_mapping_headers_mismatch");
      const qualification: CutoverQualification = { kind: "SIMULATED_FIXTURE", artifact, artifactSha256: cutoverHash(artifact), bindingSha256: runtimeBindingHash(row),
        qualifiedManifestVersion: row.version, qualifiedBy: actor.userId, qualifiedAt: new Date().toISOString() };
      await tx.$executeRaw`INSERT INTO import_cutover_runtimes(manifest_id,state,qualification,lease_manifest_version) VALUES(${id}::uuid,'PREPARED',${JSON.stringify(qualification)}::jsonb,${row.version})
        ON CONFLICT(manifest_id) DO UPDATE SET state='PREPARED',qualification=EXCLUDED.qualification,delegation=NULL,epoch=import_cutover_runtimes.epoch+1,
          lease_owner=NULL,lease_until=NULL,active_run_id=NULL,lease_manifest_version=${row.version},version=import_cutover_runtimes.version+1,updated_at=CURRENT_TIMESTAMP`;
      const runtime = (await loadCutoverRuntime(tx, id, true))!;
      await runtimeReceipt(tx, id, "QUALIFY", input.key, input.fingerprint, actor.userId, this.view(runtime));
      await this.audit(tx, row, actor.userId, authority.identities.find((identity) => identity.userId === actor.userId)?.roles ?? [], "QUALIFIED", input.key, { qualification });
      return this.view(runtime);
    });
  }
  async arm(id: string, raw: unknown, actor: Principal, disarm = false): Promise<unknown> {
    cutoverUuid(id); const input = cutoverRequest(raw), operation = disarm ? "DISARM" : "ARM";
    if (input.body.confirmed !== true) cutoverInvalid("cutover_runtime_confirmation_required");
    return this.permissions.transaction(async (tx) => {
      const row = await loadCutover(tx, id, true), authority = await this.manualAuthority(tx, row, actor, !disarm), runtime = await loadCutoverRuntime(tx, id, true);
      if (!runtime) throw new NotFoundException({ code: "cutover_runtime_not_prepared" });
      const replay = await runtimeReplay(tx, id, operation, input.key, input.fingerprint); if (replay !== undefined) return this.view(runtime);
      if (runtime.version !== input.expectedVersion) conflict("cutover_runtime_version_conflict");
      if (!disarm) {
        await this.qualification(tx, row, runtime); await this.ready(tx, row, authority);
        if (row.version !== runtime.qualification.qualifiedManifestVersion || runtime.state === "ARMED") conflict("cutover_runtime_requalification_required");
      }
      await tx.$executeRaw`UPDATE import_cutover_runtime_runs SET status='ABANDONED',finished_at=CURRENT_TIMESTAMP,error_code='cutover_runtime_disarmed'
        WHERE id=${runtime.activeRunId}::uuid AND status='RUNNING'`;
      await tx.$executeRaw`UPDATE import_cutover_runtimes SET state=${disarm ? "PAUSED" : "ARMED"},delegation=${JSON.stringify(disarm ? runtime.delegation : authority.delegation)}::jsonb,
        version=version+1,epoch=epoch+1,lease_owner=NULL,lease_until=NULL,active_run_id=NULL,lease_manifest_version=${row.version},updated_at=CURRENT_TIMESTAMP WHERE manifest_id=${id}::uuid`;
      const updated = (await loadCutoverRuntime(tx, id, true))!;
      await runtimeReceipt(tx, id, operation, input.key, input.fingerprint, actor.userId, this.view(updated));
      await this.audit(tx, row, actor.userId, authority.identities.find((identity) => identity.userId === actor.userId)?.roles ?? [], operation, input.key,
        { runtimeVersion: updated.version, delegation: authority.delegation, qualificationSha256: updated.qualification.artifactSha256, automaticPostT0Policy: "AUTOMATIC_POST_T0_POLICY_V1" });
      return this.view(updated);
    });
  }
  /** Bounded one-shot. OFF performs no database claim, source I/O or write. */
  async tick(options: { manifestId?: string; limit?: number; chunks?: number } = {}): Promise<unknown> {
    if (!cutoverWorkerEnabled(process.env)) return { skipped: "cutover_flags_off", runs: [] };
    if (process.env.CRM_BACKGROUND_WORKERS !== "external") conflict("cutover_external_worker_required");
    const limit = options.limit ?? 25, chunks = options.chunks ?? 4;
    if (!Number.isInteger(limit) || limit < 1 || limit > 25 || !Number.isInteger(chunks) || chunks < 1 || chunks > 4) cutoverInvalid("cutover_chunk_invalid");
    if (options.manifestId) cutoverUuid(options.manifestId);
    const ids = options.manifestId ? [options.manifestId] : await this.permissions.readTransaction(async (tx) => {
      this.flags(); await assertCutoverFixtureDatabase(tx);
      return (await tx.$queryRaw<Array<{ id: string }>>`SELECT manifest_id AS id FROM import_cutover_runtimes WHERE state='ARMED' ORDER BY manifest_id LIMIT 100`).map((item) => item.id);
    });
    const runs = [];
    for (const id of ids) {
      let claim: Claim | undefined;
      try {
        this.flags(); claim = await this.claim(id); if (!claim) continue;
        const ownedClaim = claim;
        const source = await this.permissions.readTransaction(async (tx) => {
          this.flags(); const { row, runtime } = await this.owned(tx, ownedClaim, false), authority = await this.authority(tx, row, runtime);
          await this.ready(tx, row, authority); return { connector: await cutoverBinding(tx, row) };
        });
        this.flags();
        const values = await this.sourceRead(source.connector.workbookId, source.connector.tab, readSheetConfiguration(source.connector.configuration));
        let processed = 0, blocked = false;
        for (let chunk = 0; chunk < chunks; chunk++) {
          this.flags();
          const result = await this.permissions.transaction(async (tx) => {
            this.flags(); let { row } = await this.owned(tx, ownedClaim, true); const runtime = (await loadCutoverRuntime(tx, id, true))!;
            const authority = await this.authority(tx, row, runtime); await this.ready(tx, row, authority);
            if (chunk === 0) {
              const previousKeys = new Set(row.inventory.map((entry) => entry.key)), observed = observeCutover(row.contract, values, row.inventory, row.headerSha256 ?? undefined);
              const automatic = observed.entries.filter((entry) => !previousKeys.has(entry.key) && entry.classification === "BACKLOG" && !entry.issue);
              const automaticKeys = new Set(automatic.map((entry) => entry.key));
              const inventory = observed.entries.map((entry) => automaticKeys.has(entry.key) ? { ...entry, decision: "KEEP_FOR_CATCHUP" as const } : entry);
              row = await updateCutover(tx, row, { ...row, inventory, headerSha256: observed.headerSha256, snapshotSha256: observed.snapshotSha256,
                observedAt: new Date(), sourceCount: observed.sourceCount, ...(cutoverCounts(inventory).sourceIssues ? { state: "BASELINED" as const, reportSha256: null } : {}) });
              ownedClaim.manifestVersion = row.version;
              if (automatic.length) await this.audit(tx, row, authority.actorId, ["SYSTEM"], "AUTOMATIC_POST_T0_POLICY", `${ownedClaim.runId}:observe`,
                { runId: ownedClaim.runId, runtimeVersion: runtime.version, epoch: ownedClaim.epoch, delegation: runtime.delegation, qualificationSha256: runtime.qualification.artifactSha256,
                  policy: "AUTOMATIC_POST_T0_POLICY_V1", sourceKeys: automatic.map((entry) => entry.key) });
              if (cutoverCounts(inventory).sourceIssues) {
                await tx.$executeRaw`UPDATE import_cutover_runtimes SET state='PAUSED',lease_manifest_version=${row.version} WHERE manifest_id=${id}::uuid`;
                await this.audit(tx, row, authority.actorId, ["SYSTEM"], "SOURCE_REVIEW_REQUIRED", `${ownedClaim.runId}:source`, { runId: ownedClaim.runId, delegation: runtime.delegation, counts: cutoverCounts(inventory) });
                this.flags(); await this.renew(tx, ownedClaim, row.version); return { processed: 0, blocked: true };
              }
            }
            const consumed = await consumeCutover(tx, row, limit, this.mappings, {
              report: () => this.bootstrap.reportCutoverRuntime(tx, row.bootstrapPackageId, authority.delegation, id, readSheetConfiguration(source.connector.configuration).assignment.strategy !== "UNASSIGNED"),
              authorizeLead: (leadId) => assertCutoverRuntimeLead(tx, authority, leadId),
              persist: (record, configuration, key, correlationId) => this.ingestion.persistScheduledCutoverRecord(tx, record, configuration.mapping, key, authority.delegation, id,
                runtime.version, correlationId, configuration.assignment),
            });
            row = await updateCutover(tx, row, { ...row }); ownedClaim.manifestVersion = row.version;
            const summary = { processed: consumed, runId: ownedClaim.runId, epoch: ownedClaim.epoch, manifestVersion: row.version, runtimeVersion: runtime.version, delegation: runtime.delegation };
            await runtimeReceipt(tx, id, "CONSUME", `${ownedClaim.runId}:${chunk}`, cutoverHash(summary), authority.actorId, summary);
            await this.audit(tx, row, authority.actorId, ["SYSTEM"], "SCHEDULED_CONSUME", `${ownedClaim.runId}:${chunk}`, summary);
            await this.authority(tx, row, runtime); this.flags();
            await this.renew(tx, ownedClaim, row.version);
            return { processed: consumed, blocked: false };
          });
          processed += result.processed; blocked = result.blocked; if (result.blocked || result.processed < limit) break;
        }
        await this.finish(claim, blocked ? "BLOCKED" : "COMPLETED", blocked ? "cutover_source_review_required" : null);
        runs.push({ id: claim.runId, manifestId: id, status: blocked ? "BLOCKED" : "COMPLETED", processed, ...(blocked ? { code: "cutover_source_review_required" } : {}) });
      } catch (error) {
        const code = cutoverRuntimeError(error); if (claim) await this.finish(claim, "FAILED", code);
        runs.push({ ...(claim ? { id: claim.runId } : {}), manifestId: id, status: "FAILED", code });
      }
    }
    return { runs };
  }
  private flags(): void { if (!cutoverWorkerEnabled(process.env)) conflict("cutover_flags_off"); }
  private async sourceRead(workbookId: string, tab: string, config: ReturnType<typeof readSheetConfiguration>): Promise<Awaited<ReturnType<SheetSource["read"]>>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.source.read(workbookId, tab, config), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ConflictException({ code: "cutover_source_timeout" })), SOURCE_TIMEOUT_MS); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  private async manualAuthority(tx: PermissionTransaction, row: StoredCutover, actor: Principal, creatorRequired = true): Promise<CutoverRuntimeAuthority> {
    const current = await currentPrincipal(tx, actor); if (current.mustChangeSecret || !current.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) permissionDenied();
    const creator = await tx.collaborator.findUnique({ where: { id: creatorRequired ? row.actorId : current.userId } }), authorizer = await tx.collaborator.findUnique({ where: { id: current.userId } });
    if (!creator || !authorizer) permissionDenied();
    const delegation: CutoverDelegation = { creatorId: creator.id, authorizedBy: authorizer.id, creatorAuthenticationVersion: creator.authenticationVersion, authorizerAuthenticationVersion: authorizer.authenticationVersion };
    const configuration = readSheetConfiguration((await cutoverBinding(tx, row)).configuration);
    return assertCutoverRuntimeAuthority(tx, this.permissions, delegation, row.campusId, row.id, configuration.assignment.strategy !== "UNASSIGNED");
  }
  private async authority(tx: PermissionTransaction, row: StoredCutover, runtime: StoredCutoverRuntime): Promise<CutoverRuntimeAuthority> {
    await this.qualification(tx, row, runtime); if (!runtime.delegation) conflict("cutover_runtime_not_armed");
    const connector = await cutoverBinding(tx, row), configuration = readSheetConfiguration(connector.configuration);
    return assertCutoverRuntimeAuthority(tx, this.permissions, runtime.delegation, row.campusId, row.id, configuration.assignment.strategy !== "UNASSIGNED");
  }
  private async qualification(tx: PermissionTransaction, row: StoredCutover, runtime: StoredCutoverRuntime): Promise<void> {
    await assertCutoverFixtureDatabase(tx); const connector = await cutoverBinding(tx, row), configuration = readSheetConfiguration(connector.configuration);
    const artifact = this.source.cutoverFixtureArtifact?.(configuration), qualification = runtime.qualification;
    if (configuration.source?.mode !== "SIMULATED" || !artifact || qualification.kind !== "SIMULATED_FIXTURE" || qualification.artifact !== artifact
      || qualification.artifactSha256 !== cutoverHash(artifact) || qualification.bindingSha256 !== runtimeBindingHash(row)) conflict("cutover_upstream_not_qualified");
  }
  private async ready(tx: PermissionTransaction, row: StoredCutover, authority: CutoverRuntimeAuthority): Promise<void> {
    cutoverFinalFreeze(row.contract.excelFrozenAt, row.contract.t0);
    const counts = cutoverCounts(row.inventory);
    if (row.state !== "READY_FOR_CATCHUP" || !row.reportSha256 || !row.observedAt || counts.sourceIssues || counts.overlapReview) conflict("cutover_reconciliation_required");
    const configuration = readSheetConfiguration((await cutoverBinding(tx, row)).configuration);
    const report = cutoverObject(await this.bootstrap.reportCutoverRuntime(tx, row.bootstrapPackageId, authority.delegation, row.id, configuration.assignment.strategy !== "UNASSIGNED"));
    if (report.cutoverBlocked !== false || cutoverHash(report) !== row.reportSha256) conflict("cutover_reconciliation_required");
  }
  private async claim(id: string): Promise<Claim | undefined> {
    return this.permissions.transaction(async (tx) => {
      this.flags(); const row = await loadCutover(tx, id, true), runtime = await loadCutoverRuntime(tx, id, true); if (!runtime || runtime.state !== "ARMED") return undefined;
      const authority = await this.authority(tx, row, runtime); await this.ready(tx, row, authority);
      if (runtime.leaseManifestVersion !== row.version) conflict("cutover_runtime_manifest_changed");
      if (runtime.leaseUntil && runtime.leaseUntil > new Date()) return undefined;
      if (runtime.activeRunId) await tx.$executeRaw`UPDATE import_cutover_runtime_runs SET status='ABANDONED',finished_at=CURRENT_TIMESTAMP,error_code='cutover_lease_expired' WHERE id=${runtime.activeRunId}::uuid AND status='RUNNING'`;
      const runId = randomUUID(), owner = randomUUID(), epoch = runtime.epoch + 1;
      await tx.$executeRaw`INSERT INTO import_cutover_runtime_runs(id,manifest_id,epoch,status) VALUES(${runId}::uuid,${id}::uuid,${epoch},'RUNNING')`;
      await tx.$executeRaw`UPDATE import_cutover_runtimes SET epoch=${epoch},lease_owner=${owner}::uuid,lease_until=${new Date(Date.now() + LEASE_MS)},active_run_id=${runId}::uuid,updated_at=CURRENT_TIMESTAMP WHERE manifest_id=${id}::uuid`;
      this.flags(); return { id, runId, owner, epoch, version: runtime.version, manifestVersion: row.version };
    });
  }
  private async owned(tx: PermissionTransaction, claim: Claim, lock: boolean): Promise<{ row: StoredCutover; runtime: StoredCutoverRuntime }> {
    const row = await loadCutover(tx, claim.id, lock), runtime = await loadCutoverRuntime(tx, claim.id, lock);
    if (!runtime || runtime.state !== "ARMED" || runtime.epoch !== claim.epoch || runtime.version !== claim.version || runtime.leaseOwner !== claim.owner
      || runtime.activeRunId !== claim.runId || !runtime.leaseUntil || runtime.leaseUntil <= new Date() || row.version !== runtime.leaseManifestVersion || row.version !== claim.manifestVersion) conflict("cutover_runtime_lease_lost");
    return { row, runtime };
  }
  private async finish(claim: Claim, status: "COMPLETED" | "FAILED" | "BLOCKED", errorCode: string | null = null): Promise<void> {
    // Cleanup never authorizes ingestion; a revoked/expired owner can only finish
    // its own still-current run, never clear a replacement owner's lease.
    await this.permissions.transaction(async (tx) => {
      await loadCutover(tx, claim.id, true); const runtime = await loadCutoverRuntime(tx, claim.id, true);
      if (!runtime || runtime.epoch !== claim.epoch || runtime.leaseOwner !== claim.owner || runtime.activeRunId !== claim.runId) return;
      await tx.$executeRaw`UPDATE import_cutover_runtime_runs SET status=${status},finished_at=CURRENT_TIMESTAMP,error_code=${errorCode} WHERE id=${claim.runId}::uuid AND status='RUNNING'`;
      await tx.$executeRaw`UPDATE import_cutover_runtimes SET state=${status === "FAILED" ? "PAUSED" : runtime.state},lease_owner=NULL,lease_until=NULL,active_run_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE manifest_id=${claim.id}::uuid`;
    });
  }
  private async renew(tx: PermissionTransaction, claim: Claim, manifestVersion: number): Promise<void> {
    const changed = await tx.$executeRaw`UPDATE import_cutover_runtimes SET lease_until=${new Date(Date.now() + LEASE_MS)},lease_manifest_version=${manifestVersion},updated_at=CURRENT_TIMESTAMP
      WHERE manifest_id=${claim.id}::uuid AND version=${claim.version} AND epoch=${claim.epoch} AND lease_owner=${claim.owner}::uuid AND active_run_id=${claim.runId}::uuid AND lease_until>clock_timestamp()`;
    if (changed !== 1) conflict("cutover_runtime_lease_lost");
  }
  private view(runtime: StoredCutoverRuntime): Record<string, unknown> {
    return { state: runtime.state, version: runtime.version, epoch: runtime.epoch, qualification: runtime.qualification,
      delegation: runtime.delegation, activeRunId: runtime.activeRunId, leaseUntil: runtime.leaseUntil?.toISOString() ?? null,
      automaticActivationAvailable: false, qualificationScope: "NONCE_ISOLATED_SYNTHETIC_ONLY", googleQualification: "PREPARATION_ONLY",
      flags: { sheets: process.env.SHEETS_ENABLED === "true", cutover: process.env.SHEET_CUTOVER_ENABLED === "true" } };
  }
  private async audit(tx: PermissionTransaction, row: StoredCutover, actorId: string, roles: readonly string[], operation: string, key: string, after: unknown): Promise<void> {
    await tx.auditEvent.create({ data: { actorId, actorRoles: [...roles], campusId: row.campusId, eventType: `CUTOVER_RUNTIME_${operation}`, resourceType: "IMPORT_CUTOVER", resourceId: row.id,
      result: "SUCCESS", correlationId: `cutover:${row.id}`, idempotencyKey: `c63runtime:${row.id}:${cutoverHash([operation, key])}`, after: json(after) } });
  }
}
