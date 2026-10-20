export interface AuditItem { id: string; eventType: string; actorId: string | null; actorRoles: string[]; campusId: string | null; resourceType: string | null; resourceId: string | null; result: string; occurredAt: string; before: Record<string, number | boolean>; after: Record<string, number | boolean>; actorDisplay?: { kind: string; label: string | null }; leadDisplay?: { kind: string; id: string | null; label: string | null; reference: string | null } }
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
function displayText(value: unknown, limit: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/\p{Cc}/u.test(value); }
/** Missing enrichment (including an older API during image rollout) is unavailable,
 * never reconstructed from IDs, arbitrary metadata or an email address. */
export function auditActor(item: AuditItem): { label: string; note: string } {
  if (item.actorDisplay?.kind === "SYSTEM") return { label: "Système", note: "Exécution technique" };
  if (item.actorDisplay?.kind === "CURRENT_PROFILE" && displayText(item.actorDisplay.label, 120)) return { label: item.actorDisplay.label, note: "Profil actuel" };
  return { label: "Profil indisponible", note: "Identité historique non restituée" };
}
export function auditLead(item: AuditItem): { label: string; reference: string | null; href: string | null } {
  const lead = item.leadDisplay;
  if (lead?.kind === "CURRENT_RECORD" && typeof lead.id === "string" && uuid.test(lead.id) && displayText(lead.label, 201) && typeof lead.reference === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(lead.reference)) return { label: lead.label, reference: lead.reference, href: `/leads/${encodeURIComponent(lead.id)}` };
  return { label: lead?.kind === "NOT_APPLICABLE" ? "Non concerné" : "Dossier indisponible ou hors accès", reference: null, href: null };
}
const actionLabels: Readonly<Record<string, string>> = {
  LEAD_CREATED: "Lead ajouté", LEAD_UPDATED: "Fiche modifiée", LEAD_ASSIGNED: "Lead affecté", LEAD_REASSIGNED: "Lead réaffecté",
  FOLLOW_UP_CREATED: "Relance programmée", FOLLOW_UP_DUE: "Relance arrivée à échéance", FOLLOW_UP_COMPLETED: "Relance réalisée", FOLLOW_UP_CANCELLED: "Relance annulée",
  APPOINTMENT_CREATED: "Rendez-vous demandé", APPOINTMENT_CONFIRMED: "Rendez-vous confirmé", APPOINTMENT_CANCELLED: "Rendez-vous annulé",
  AUDIT_SEARCHED: "Journal consulté", AUDIT_VIEWED: "Événement consulté",
};
export function auditAction(item: AuditItem): string { return actionLabels[item.eventType] ?? "Action enregistrée"; }
export function auditResult(item: AuditItem): string { return ({ SUCCESS: "Succès", DENIED: "Refusé", FAILED: "Échec" } as Record<string, string>)[item.result] ?? "Non renseigné"; }
export interface AuditPage { items: AuditItem[]; page: number; pageSize: number; total: number; snapshot: string; campuses: Array<{ id: string }>; global: boolean }
export const auditFields = [
  ["from", "Depuis (UTC)", "datetime-local"], ["to", "Jusqu’au (UTC)", "datetime-local"],
  ["actorId", "Identifiant de l’acteur", "text"], ["eventType", "Type d’action", "text"],
  ["resourceId", "Identifiant de ressource / lead", "text"], ["resourceType", "Type de ressource", "text"],
] as const;
export function auditQuery(form: FormData): string {
  const query = new URLSearchParams();
  for (const [key] of auditFields) {
    const value = form.get(key); if (typeof value !== "string" || !value.trim()) continue;
    if (key === "from" || key === "to") query.set(key, new Date(value + "Z").toISOString());
    else query.set(key, value.trim());
  }
  for (const key of ["campus", "result"]) { const value = form.get(key); if (typeof value === "string" && value) query.set(key, value); }
  return query.toString();
}
export function auditError(status: number): string {
  if (status === 401) return "Votre session a expiré. Reconnectez-vous.";
  if (status === 403) return "Accès refusé : rôle admissible et permission audit.view requis dans ce périmètre.";
  if (status === 404) return "Événement absent ou inaccessible dans votre périmètre.";
  if (status === 400) return "Filtres invalides. Vérifiez les identifiants, les dates et les codes d’action.";
  return "Journal indisponible. Aucune donnée de secours n’est affichée.";
}
export class AuditRequestError extends Error {
  constructor(readonly status: number) { super(auditError(status)); this.name = "AuditRequestError"; }
}
export async function auditRequest<T>(path: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<T> {
  const response = await request(`/api/crm/audit-events${path}`, { credentials: "same-origin", cache: "no-store", signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new AuditRequestError(response.status);
  return await response.json() as T;
}
export function auditDate(value: string): string { return new Intl.DateTimeFormat("fr-MA", { timeZone: "Africa/Casablanca", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)); }
