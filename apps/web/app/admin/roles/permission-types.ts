export type Scope = "NONE" | "OWN" | "TEAM" | "CAMPUS" | "GLOBAL";
export const scopeLabels: Record<Scope, string> = { NONE: "Aucun droit", OWN: "Affecté ou collaborateur actif", TEAM: "Équipe actuelle du conseiller principal", CAMPUS: "Campus", GLOBAL: "Global" };
const moduleNames: Record<string, string> = { lead: "Leads et dossiers", interaction: "Interactions", reminder: "Relances", appointment: "Rendez-vous", import: "Imports", reporting: "Pilotage", users: "Utilisateurs", roles: "Rôles et droits", settings: "Paramétrage", audit: "Journal d’audit", chat: "Communication", notification: "Notifications" };
const permissionNames: Record<string, string> = {
  "lead.view": "Consulter les Leads", "lead.create": "Créer un Lead", "lead.edit": "Corriger les informations d’un Lead", "lead.qualification.update": "Qualifier la température commerciale",
  "lead.assign": "Affecter un Lead", "lead.reassign.request": "Demander une réaffectation", "lead.reassign.approve": "Décider une réaffectation", "lead.close.request": "Demander une clôture", "lead.close.approve": "Décider une clôture",
  "lead.tags.assign": "Associer des étiquettes", "lead.collaborators.manage": "Gérer les collaborateurs du dossier", "lead.tags.manage": "Administrer les étiquettes", "lead.references.view": "Consulter les référentiels", "lead.references.manage": "Administrer les référentiels", "lead.references.archive": "Archiver une valeur de référentiel",
  "lead.views.view": "Consulter les vues enregistrées", "lead.views.share.team": "Partager une vue avec une équipe", "lead.views.share.campus": "Partager une vue avec un campus", "lead.views.revoke.own": "Retirer son propre partage", "lead.views.revoke.team": "Retirer un partage d’équipe", "lead.views.revoke.campus": "Retirer un partage de campus",
  "interaction.create": "Enregistrer une interaction", "interaction.view": "Consulter les interactions", "reminder.manage": "Gérer les relances", "appointment.manage": "Gérer les rendez-vous",
  "import.view": "Consulter les imports", "import.execute": "Exécuter un import", "import.confirm": "Confirmer un import", "import.review.resolve": "Résoudre une ligne à vérifier", "import.report.export": "Exporter un rapport d’import",
  "reporting.view": "Consulter les tableaux de bord", "reporting.export": "Exporter les indicateurs", "reporting.global.view": "Consulter le pilotage global",
  "users.view": "Consulter les utilisateurs", "users.create": "Créer un utilisateur", "users.edit": "Modifier le profil d’un utilisateur", "users.disable": "Désactiver un utilisateur", "users.roles.assign": "Attribuer les rôles",
  "roles.permissions.view": "Consulter la configuration des droits", "roles.permissions.manage": "Modifier la configuration des droits", "settings.campus.manage": "Administrer un campus", "settings.global.manage": "Administrer les paramètres globaux",
  "audit.view": "Consulter le journal d’audit", "audit.export": "Exporter le journal d’audit", "chat.use": "Utiliser le chat interne", "chat.broadcast": "Publier une annonce interne", "notification.manage": "Gérer les notifications",
};
export function moduleLabel(module: string): string { return moduleNames[module] ?? "Autres fonctions"; }
export function permissionLabel(key: string): string { return permissionNames[key] ?? "Capacité à examiner"; }
export function restrictionLabel(value: string | null): string {
  if (!value) return "Aucune restriction supplémentaire";
  return ({ auditor_read_only: "Rôle Lecteur limité à la consultation", resource_inactive: "Ressource inactive", permission_or_session_invalid: "Session ou droit non valide", manager_approval_required: "Validation Manager obligatoire" } as Record<string, string>)[value] ?? "Une règle métier limite cette action";
}
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
