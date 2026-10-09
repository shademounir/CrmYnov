export type CutoverState = "DRAFT" | "BASELINED" | "READY_FOR_CATCHUP" | "SUSPENDED";
export interface CutoverCapabilities { canObserve: boolean; canDecide: boolean; canReconcile: boolean; canSuspend: boolean; canResume: boolean; canConsume: boolean; canCompensate: boolean }
export interface CutoverContext {
  campuses: Array<{ id: string; label: string; canCreate: boolean }>;
  connectors: Array<{ id: string; campusId: string; label: string; enabled: boolean; sourceSheetId?: number | null; identityMode?: string | null }>;
}
export interface CutoverSubmission {
  key: string; externalId: string; fingerprint: string; originalArrivedAt: string;
  classification: "EXCLUDED_PRE_T0" | "BACKLOG"; issue: "SOURCE_CHANGED" | "SOURCE_REMOVED" | null;
  decision: "KEEP_FOR_CATCHUP" | "LINK_BASELINE" | null; targetBootstrapRowId: string | null;
}
export interface CutoverManifest {
  id: string; campusId: string; state: CutoverState; version: number;
  contract: { bootstrapPackageId: string; connectorId: string; excelSha256: string; configurationSha256: string; t0: string; timeZone: string; excelFrozenAt: string; originalArrivalColumn: string; externalIdColumn: string; identityEvidenceSha256: string; sourceSheetId?: number };
  counts: Record<string, number>; sourceCount: number; headerSha256: string | null; snapshotSha256: string | null; observedAt: string | null; reportSha256: string | null; suspensionReason: string | null;
  localT0: string; submissions: CutoverSubmission[]; automaticActivationAvailable: false; effectsApplied: boolean; limitations: string[];
  capabilities?: CutoverCapabilities; bindingValid?: boolean;
  effects?: CutoverEffect[];
  catchup?: { total: number; created: number; linkedBaseline: number; review: number; pending: number; complete: boolean };
  compensationApplied?: false;
}
export interface CutoverEffect { id: string; sourceKey: string; outcome: "CREATED" | "LINKED_BASELINE" | "REVIEW"; batchId: string | null; reason: string | null; compensationStatus: "REQUESTED" | "BLOCKED_DOWNSTREAM" | null; compensationReason: string | null; createdAt: string; comparedAt: string | null; leadVisible: boolean; leadId?: string }
export class CutoverApiError extends Error { constructor(readonly status: number, readonly code: string) { super("cutover_request_refused"); } }
export function cutoverId(value: string): string | undefined { return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu.test(value) ? value : undefined; }
export function cutoverUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  const date = new Date(value); return Number.isFinite(date.valueOf()) && date.toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
}
export function cutoverFreezeAtT0(freeze: string, t0: string): boolean {
  return cutoverUtc(freeze) && cutoverUtc(t0) && new Date(freeze).toISOString() === new Date(t0).toISOString();
}
export function cutoverZone(value: string): boolean { try { new Intl.DateTimeFormat("fr-MA", { timeZone: value }).format(new Date(0)); return value.length > 0 && value === value.trim(); } catch { return false; } }
export function cutoverLocalInstant(value: string, timeZone: string): string {
  if (!cutoverUtc(value) || !cutoverZone(timeZone)) return "Instant ou fuseau à vérifier";
  return new Intl.DateTimeFormat("fr-MA", { timeZone, dateStyle: "medium", timeStyle: "long" }).format(new Date(value));
}
export async function cutoverRequest<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/crm/lead-import/cutover${path}`, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code = payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string" ? payload.code : "cutover_unavailable";
    throw new CutoverApiError(response.status, code);
  }
  return await response.json() as T;
}
export function cutoverFailure(failure: unknown): string {
  if (failure instanceof CutoverApiError) {
    if (failure.status === 401) return "Votre session a expiré. Reconnectez-vous puis relisez le manifeste ; aucun résultat supplémentaire n’est confirmé.";
    if (failure.status === 403 || failure.status === 404) return "Cette action ou cette ressource n’est pas autorisée dans votre périmètre actuel. Aucun droit n’a été élargi.";
    if (failure.code === "cutover_producer_must_be_stopped") return "Le connecteur doit rester désactivé et sans traitement actif. Aucune activation ni interruption forcée n’a été effectuée.";
    if (failure.code === "cutover_freeze_delta_unqualified") return "Ce premier lot exige un gel final Excel au même instant que T0, après prise en compte du delta. Deux dates déclarées égales ne prouvent pas que le snapshot final et sa couverture ont réellement été vérifiés.";
    if (failure.code === "cutover_reconciliation_incomplete") return "La réconciliation reste incomplète : examinez les décisions, les écarts source et le rapport Excel. La bascule n’est pas qualifiée.";
    if (failure.status === 409) return "Le manifeste, la source ou une version a changé. Relisez l’état durable avant de poursuivre ; ne recréez pas le manifeste.";
    if ([400, 413, 422].includes(failure.status)) return "Les références, l’identité durable ou les instants ont été refusés. Vérifiez les valeurs et la preuve source ; aucune valeur n’est devinée.";
  }
  return "Le serveur n’a pas confirmé le résultat. Relisez le manifeste avant de réessayer : seuls les reçus persistants font foi.";
}
export function cutoverAttempt(attempts: Map<string, { payload: string; key: string }>, operation: string, body: object): string {
  const payload = JSON.stringify(body), previous = attempts.get(operation);
  if (previous?.payload === payload) return previous.key;
  const key = `cutover-${crypto.randomUUID()}`; attempts.set(operation, { payload, key }); return key;
}
export function cutoverCan(manifest: CutoverManifest, capability: keyof CutoverCapabilities): boolean { return manifest.bindingValid !== false && manifest.capabilities?.[capability] === true; }
export const cutoverStateLabels: Readonly<Record<CutoverState, string>> = { DRAFT: "Préparation à observer", BASELINED: "Inventaire durable · réconciliation attendue", READY_FOR_CATCHUP: "Réconciliation préparée · aucune activation automatique", SUSPENDED: "Préparation suspendue" };
export const cutoverLimitLabels: Readonly<Record<string, string>> = {
  SOURCE_IDENTITY_EVIDENCE_DECLARED_NOT_UPSTREAM_ATTESTED: "La référence de preuve est déclarée ; elle n’atteste pas à elle seule l’immutabilité de l’identifiant en amont.",
  CATCHUP_CONSUMER_NOT_IMPLEMENTED: "L’exécution du rattrapage n’est pas disponible dans ce lot préparatoire.",
  AUTOMATIC_CATCHUP_NOT_IMPLEMENTED: "Le rattrapage disponible est manuel et borné. Aucun traitement automatique n’est activé.",
  RECOVERABLE_COMPENSATION_NOT_IMPLEMENTED: "Une demande de compensation peut être consignée ; le retrait récupérable du Lead n’est pas implémenté par ce lot.",
  LOCAL_ROW_NOT_SUPPORTED: "Une position de ligne ne constitue jamais une identité durable.",
  SHEETS_REMAINS_DISABLED: "Le flux Sheets automatique reste désactivé.",
};
