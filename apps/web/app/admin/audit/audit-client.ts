export interface AuditItem { id: string; eventType: string; actorId: string | null; actorRoles: string[]; campusId: string | null; resourceType: string | null; resourceId: string | null; result: string; occurredAt: string; before: Record<string, number | boolean>; after: Record<string, number | boolean> }
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
export async function auditRequest<T>(path: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<T> {
  const response = await request(`/api/crm/audit-events${path}`, { credentials: "same-origin", cache: "no-store", signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(auditError(response.status));
  return await response.json() as T;
}
export function auditDate(value: string): string { return new Intl.DateTimeFormat("fr-MA", { timeZone: "Africa/Casablanca", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)); }
