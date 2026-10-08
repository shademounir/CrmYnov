export const bootstrapChunkBytes = 48 * 1024;
export const bootstrapFileLimit = 5 * 1024 * 1024;
export const bootstrapSheets = ["VISITES ET APPELS", "LEADS YNOV.COM", "LEADS YNOV.MA", "JOBINTECH REACT"] as const;
export type BootstrapState = "UPLOADING" | "SEALED" | "MAPPED" | "PARTIAL" | "COMPLETED";
export interface BootstrapPackage {
  id: string; fileName: string; sizeBytes: number; sha256: string; campusId: string; state: BootstrapState;
  version: number; receivedChunks: number; expectedChunks: number;
  sheets: Array<{ name: string; relationId: string; rowCount: number; columns: Array<{ letter: string; name: string }> }>;
  counts: { total: number; accepted: number; review: number; invalid: number; ignored: number; pending: number };
  batchId?: string; replayed?: boolean;
}
export interface BootstrapContext {
  campuses: Array<{ id: string; code: string; label: string; canUpload?: boolean; canMap?: boolean; canDecide?: boolean; canConfirm?: boolean }>;
  owners: Array<{ id: string; label: string; campusId: string }>;
  programs: Array<{ code: string; label: string; campusId: string | null }>;
  campaigns: Array<{ code: string; label: string; campusId: string | null }>;
  educationLevels: string[]; sources: string[]; statuses: string[];
  canUpload?: boolean; canMap?: boolean; canDecide?: boolean; canConfirm?: boolean;
}
export interface BootstrapCycleDecision {
  state: "UNSPECIFIED" | "CONFIRMED_TARGET" | "HISTORICAL_ENROLMENT" | "REVIEW";
  label?: string; sourceColumns: string[]; reason: string;
}
export interface BootstrapSourceEvidence { column: string; reference: string; text: string | null; formula: boolean }
export interface BootstrapNativeAnnotation { annotationId: string; reference: string; text: string; author: string | null; relationshipId: string; format?: "LEGACY" | "THREADED"; sourceDate?: string | null; parentAnnotationId?: string; personId?: string }
export interface BootstrapAnnotationDecision { annotationId: string; reference: string; relationshipId: string; action: "PRESERVE_NOTE" | "EXCLUDE"; reason: string }
export interface BootstrapCellEvidence extends BootstrapSourceEvidence { raw: string | null; type: string; formulaText?: string; style?: unknown }
export interface BootstrapRow {
  id: string; sheet: string; rowNumber: number; fingerprint: string; version: number;
  state: "REVIEW" | "READY" | "ACCEPTED" | "INVALID" | "IGNORED";
  reasons: string[]; values: Record<string, string | null>; comments: Array<{ column: string; text: string }>;
  sourceOwner: string | null; replacementOwner: string | null;
  annotations?: BootstrapNativeAnnotation[];
  sourceEvidence?: BootstrapCellEvidence[]; sourceEvidenceTruncated?: boolean;
  decision?: { action: "CREATE_DOSSIER" | "LINK_EXISTING" | "IGNORE"; reason: string; targetLeadId?: string; overrides?: Record<string, string>; resolvedValues?: Record<string, string | null>; cycle?: BootstrapCycleDecision & { evidence?: BootstrapSourceEvidence[] }; annotations?: BootstrapAnnotationDecision[] }; leadId?: string; canReopen?: boolean;
}
export interface BootstrapRows { items: BootstrapRow[]; nextAfter: string | null }
export interface BootstrapReport {
  package: BootstrapPackage;
  bySheet: Array<{ name: string; total: number; accepted: number; review: number; invalid: number; ignored: number }>;
  cutoverBlocked: boolean;
  reconciliation?: BootstrapReconciliation;
  sourceCoverage?: { complete: boolean; bySheet: Array<{ name: string; sourceCandidates: number; sourceRows: number; ledgerRows: number; literalCells: number; commentCells: number; formulaCells: number; nativeAnnotations: number; unmappedCells: number; excludedCells: number; quarantinedAnnotations: number }> };
}
export interface BootstrapReconciliation {
  complete: boolean; truncated: boolean; totalOccurrences: number; unresolvedOccurrences: number;
  effects: Record<string, number>;
  contacts: { email: { groups: number; occurrences: number }; phone: { groups: number; occurrences: number }; overlappingGroupsNotUniquePeople: true };
  currentDossierAxes: { visible: number; withheld: number };
  axes: Record<string, Record<string, number>>; discrepancies: Array<{ code: string; count: number }>;
}
export type BootstrapField = "firstName" | "lastName" | "email" | "phone" | "program" | "educationLevel" | "source" | "status" | "temperature" | "owner" | "replacementOwner" | "receivedDate";
export const bootstrapFields: ReadonlyArray<readonly [BootstrapField, string]> = [
  ["firstName", "Prénom"], ["lastName", "Nom"], ["email", "Email"], ["phone", "Téléphone"],
  ["program", "Formation"], ["educationLevel", "Niveau"], ["source", "Source / canal exact"],
  ["status", "Statut commercial"], ["temperature", "Température"], ["owner", "Responsable initial"], ["replacementOwner", "Nouveau responsable prioritaire"],
  ["receivedDate", "Date de réception source · provenance seulement"],
];
export interface BootstrapSheetMapping {
  name: string; campaign: string; fields: Partial<Record<BootstrapField, string>>;
  commentColumns: string[]; ownerAliases: Record<string, string>;
  excludedColumns?: Array<{ column: string; reason: string }>;
}
export interface HistoricalNote {
  id: string; text: string; sourceSheet: string; sourceRow: number; sourceColumn: string;
  author: string | null; occurredAt: null; importedAt: string;
}

export class BootstrapApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export async function bootstrapRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (typeof init?.body === "string" && new TextEncoder().encode(init.body).byteLength > 90 * 1024) throw new BootstrapApiError(413, "bootstrap_request_too_large");
  const response = await fetch(`/api/crm/lead-import/bootstrap${path}`, {
    ...init, cache: "no-store", credentials: "same-origin",
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code = payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string" ? payload.code : "bootstrap_unavailable";
    throw new BootstrapApiError(response.status, code);
  }
  return await response.json() as T;
}
export function bootstrapFailure(error: unknown): string {
  if (error instanceof BootstrapApiError) {
    if (error.status === 401) return "Votre session a expiré. Reconnectez-vous puis reprenez ce lot ; aucune réussite supplémentaire n’est confirmée.";
    if (error.status === 403) return "Votre rôle ou votre périmètre ne permet pas cette action. Les données et droits existants sont conservés.";
    if (error.status === 404) return "Ce lot ou cette ressource n’est pas accessible dans votre périmètre.";
    if (error.status === 409) return "La version ou le contenu a changé. Actualisez le lot avant de réessayer ; aucune nouvelle réussite n’est déduite.";
    if (error.status === 400 || error.status === 413 || error.status === 422) return "Le serveur a refusé le fichier ou la décision. Vérifiez les valeurs obligatoires, les colonnes et les anomalies ; rien n’est confirmé comme importé.";
  }
  return "Le serveur n’a pas confirmé le résultat. Actualisez ce lot avant de réessayer ; les reçus persistants font foi.";
}
export function packageKey(value: string): string | undefined {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : undefined;
}
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export async function bootstrapHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function mappingForSheets(source: BootstrapPackage): BootstrapSheetMapping[] {
  return source.sheets.map((sheet) => ({ name: sheet.name, campaign: "", fields: {}, commentColumns: [], ownerAliases: {} }));
}
export function confirmedPackageState(state: BootstrapState): boolean {
  return state === "MAPPED" || state === "PARTIAL" || state === "COMPLETED";
}
export function bootstrapCapabilities(context: BootstrapContext | null, campusId: string): Readonly<{ canUpload: boolean; canMap: boolean; canDecide: boolean; canConfirm: boolean }> {
  const campus = context?.campuses.find((item) => item.id === campusId);
  return { canUpload: campus?.canUpload === true, canMap: campus?.canMap === true, canDecide: campus?.canDecide === true, canConfirm: campus?.canConfirm === true };
}
export const bootstrapStateLabels: Readonly<Record<BootstrapState, string>> = {
  UPLOADING: "Transfert à reprendre", SEALED: "Fichier scellé · mapping attendu", MAPPED: "Prévisualisation enregistrée",
  PARTIAL: "Reprise partielle enregistrée", COMPLETED: "Traitement terminé · rapport à examiner",
};
export const bootstrapRowLabels: Readonly<Record<BootstrapRow["state"], string>> = {
  REVIEW: "À vérifier", READY: "Décision en attente d’exécution", ACCEPTED: "Reçu d’import acquis", INVALID: "Invalide", IGNORED: "Écarté avec motif",
};
export function stableBootstrapAttempt(ref: { current: { payload: string; key: string } | undefined }, body: object): string {
  const payload = JSON.stringify(body);
  if (ref.current?.payload !== payload) ref.current = { payload, key: `bootstrap-${crypto.randomUUID()}` };
  return ref.current.key;
}
