import { BootstrapApiError, bootstrapHash, type BootstrapPackage, type BootstrapReport, type BootstrapRow, type BootstrapRows } from "./bootstrap-client";
import type { BootstrapRowDecision } from "./bootstrap-row-review";

export type BatchDecision = Omit<BootstrapRowDecision, "expectedVersion" | "idempotencyKey"> | { action: "DEFER"; reason: string; confirmed: true };
export interface BatchPlan { schemaVersion: 1; packageId: string; sha256: string; items: Array<{ rowId: string; fingerprint: string; expectedVersion: number; decision: BatchDecision }> }
export interface BatchProgress { checked: number; committed: number; deferred: number; alreadyPersisted: number; failures: Array<{ rowId: string; code: string }>; report?: BootstrapReport }
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i, sha = /^[a-f0-9]{64}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
const digest = (value: unknown): Promise<string> => bootstrapHash(new TextEncoder().encode(canonical(value)).buffer);
export function parseBatchPlan(text: string, source: BootstrapPackage): BatchPlan {
  if (new TextEncoder().encode(text).byteLength > 8 * 1024 * 1024) throw new Error("bootstrap_plan_too_large");
  const plan: unknown = JSON.parse(text);
  if (!record(plan) || plan.schemaVersion !== 1 || plan.packageId !== source.id || plan.sha256 !== source.sha256
    || !Array.isArray(plan.items) || !plan.items.length || plan.items.length > 10000 || plan.items.some(item => !record(item)
      || typeof item.rowId !== "string" || !uuid.test(item.rowId) || typeof item.fingerprint !== "string" || !sha.test(item.fingerprint)
      || !Number.isInteger(item.expectedVersion) || Number(item.expectedVersion) < 1 || !record(item.decision)
      || !["CREATE_DOSSIER", "LINK_EXISTING", "IGNORE", "DEFER"].includes(String(item.decision.action))
      || typeof item.decision.reason !== "string" || item.decision.reason.trim().length < 8 || item.decision.reason.length > 1000
      || "idempotencyKey" in item.decision || "expectedVersion" in item.decision
      || (item.decision.action === "DEFER" && item.decision.confirmed !== true))
    || new Set(plan.items.map((item: unknown) => record(item) ? item.rowId : null)).size !== plan.items.length) throw new Error("bootstrap_plan_invalid_or_wrong_package");
  return plan as unknown as BatchPlan;
}
export async function readBatchRows(id: string, request: Request): Promise<BootstrapRow[]> {
  const rows: BootstrapRow[] = [], seen = new Set<string>(); let after: string | null = null;
  do {
    const page: BootstrapRows = await request(`/packages/${id}/rows?${new URLSearchParams({ limit: "50", ...(after ? { after } : {}) })}`);
    for (const row of page.items) { if (seen.has(row.id) || rows.length >= 10000) throw new Error("bootstrap_ledger_changed"); seen.add(row.id); rows.push(row); }
    after = page.nextAfter; if (after && !page.items.some(row => row.id === after)) throw new Error("bootstrap_cursor_invalid");
  } while (after);
  return rows;
}
/** No credentials or private browser storage. Requests use the official BFF.
 * A reload resumes from durable row keys; an uncertain response retries the
 * identical body once. Auth/version/unknown failures stop, never auto-DEFER. */
export async function runBatchPlan(plan: BatchPlan, request: Request, onProgress: (progress: BatchProgress) => void, stopped: () => boolean): Promise<BatchProgress> {
  const progress: BatchProgress = { checked: 0, committed: 0, deferred: 0, alreadyPersisted: 0, failures: [] };
  const root = `/packages/${plan.packageId}`;
  const rows = new Map((await readBatchRows(plan.packageId, request)).map(row => [row.id, row]));
  const pending: Array<{ rowId: string; fingerprint: string; decision: BatchDecision & { expectedVersion: number; idempotencyKey: string } }> = [];
  for (const item of plan.items) {
    const row = rows.get(item.rowId); const key = `operator-row-${await digest({ packageId: plan.packageId, sha256: plan.sha256, ...item })}`;
    if (!row || row.fingerprint !== item.fingerprint) throw new Error("bootstrap_plan_source_changed");
    if (["ACCEPTED", "IGNORED", "DEFERRED"].includes(row.state)) {
      if (row.decision?.idempotencyKey !== key) throw new Error("bootstrap_plan_other_decision_present");
      progress.alreadyPersisted++; progress.checked++; continue;
    }
    if (row.state !== "REVIEW" || row.version !== item.expectedVersion || row.decision) throw new Error("bootstrap_plan_row_version_changed");
    pending.push({ rowId: item.rowId, fingerprint: item.fingerprint, decision: { ...item.decision, expectedVersion: item.expectedVersion, idempotencyKey: key } });
  }
  onProgress({ ...progress });
  async function execute(items: typeof pending): Promise<void> {
    if (stopped()) return;
    const current = await request<BootstrapPackage>(root);
    if (current.sha256 !== plan.sha256) throw new Error("bootstrap_plan_source_changed");
    const body = { expectedVersion: current.version, sha256: plan.sha256, confirmed: true, items,
      idempotencyKey: `operator-block-${await digest({ packageId: plan.packageId, sha256: plan.sha256, items })}` };
    type Result = { report: BootstrapReport; block: { rowIds: string[]; deferredRowIds: string[] } };
    let result: Result;
    const send = (): Promise<Result> => request(`${root}/execute-block`, { method: "POST", body: JSON.stringify(body) });
    try {
      try { result = await send(); }
      catch (error) {
        if (error instanceof BootstrapApiError && error.status < 500) throw error;
        result = await send(); // Exact receipt replay only; never recompute version/key after an uncertain write.
      }
    } catch (error) {
      if (error instanceof BootstrapApiError && [400, 422].includes(error.status)) {
        if (items.length > 1) { const split = Math.ceil(items.length / 2); await execute(items.slice(0, split)); await execute(items.slice(split)); return; }
        progress.failures.push({ rowId: items[0]!.rowId, code: error.code }); progress.checked++; onProgress({ ...progress, failures: [...progress.failures] }); return;
      }
      throw error;
    }
    if (!result.report.reconciliation || result.report.reconciliation.truncated || result.report.reconciliation.discrepancies.length
      || result.report.package.id !== plan.packageId || result.report.package.sha256 !== plan.sha256
      || result.block.rowIds.length + result.block.deferredRowIds.length !== items.length
      || new Set([...result.block.rowIds, ...result.block.deferredRowIds]).size !== items.length
      || items.some(item => ![...result.block.rowIds, ...result.block.deferredRowIds].includes(item.rowId))) throw new Error("bootstrap_block_result_unverified");
    progress.committed += result.block.rowIds.length; progress.deferred += result.block.deferredRowIds.length; progress.checked += items.length; progress.report = result.report;
    onProgress({ ...progress, failures: [...progress.failures] });
  }
  // 25 is the maximum transaction size, not the total target. Stop is observed
  // between transactions, never by aborting an in-flight database operation.
  for (let index = 0; index < pending.length && !stopped(); index += 25) await execute(pending.slice(index, index + 25));
  progress.report = await request<BootstrapReport>(`${root}/report`); onProgress({ ...progress }); return progress;
}
