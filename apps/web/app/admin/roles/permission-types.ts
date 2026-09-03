export type Scope = "NONE" | "OWN" | "TEAM" | "CAMPUS" | "GLOBAL";
export const scopeLabels: Record<Scope, string> = { NONE: "Aucun droit", OWN: "Affecté ou collaborateur actif", TEAM: "Équipe actuelle du conseiller principal", CAMPUS: "Campus", GLOBAL: "Global" };
export interface Definition { key: string; module: string; mutation: boolean; sensitive: boolean; scopes: Scope[]; reserved: boolean; available?: boolean }
export interface Catalogue { campus: string; catalogueVersion: number; catalogue: Definition[]; roles: { role: string; label: string; description: string; users: number; editable: boolean }[]; campuses: { id: string; code: string }[]; global: boolean }
export interface Configuration { kind: "ROLE" | "CEILING"; role: string; campus: string; version: number; inherited: boolean; grants: Record<string, Scope>; globalCeiling: Record<string, Scope> }
export interface Change { permission: string; from: Scope; to: Scope; widening: boolean; sensitive: boolean }
export interface Preview { changes: Change[]; affectedUsers: number; expectedVersion: number; mutated: false }
export interface Version { number: number; createdAt: string; audits: { actorId: string; actorRoles: string[]; reason: string; createdAt: string }[] }
export interface Explanation { permissions: { permission: string; allowed: boolean; restriction: string | null; sources: { role: string; sourceScope: Scope; globalCeiling: Scope; campusCeiling: Scope; campusGrant: Scope; allowed: boolean; restriction: string | null }[] }[]; businessRules: string }
export function isLocked(item: Definition, configuration: Configuration, editable: boolean): boolean {
  return item.available === false || !editable || configuration.role === "AUDITOR" && item.mutation || configuration.campus !== "GLOBAL" && item.reserved || configuration.campus === "GLOBAL" && (configuration.role === "SUPER_ADMIN" || configuration.kind === "CEILING") && ["roles.permissions.view", "roles.permissions.manage"].includes(item.key);
}
export function offeredScopes(item: Definition, campus: string): Scope[] { return item.scopes.filter((scope) => campus === "GLOBAL" || scope !== "GLOBAL"); }
export function changeLabel(change: Change): string {
  if (change.to === "NONE") return "Retrait";
  if (change.from === "NONE") return "Ajout";
  return change.widening ? "Élargissement / changement de ressources" : "Réduction";
}
export async function permissionRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/crm/admin/role-permissions/${path}`, { cache: "no-store", credentials: "same-origin", ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(response.status === 409 ? "Conflit de version : rechargez avant de réessayer." : "Accès refusé ou service indisponible. Aucun droit de secours n’est appliqué.");
  return await response.json() as T;
}
