export interface PoolMember { userId: string; active: boolean; capacity: number; activeLeadCount: number; suspended?: boolean; excluded?: boolean }
export interface PoolRule { id: string; scope: "GLOBAL" | "SOURCE" | "CAMPAIGN"; matchValue?: string; strategy: "ROUND_ROBIN" | "CONTROLLED_RANDOM"; balanceNewEntrants?: boolean; enabled: boolean; candidates: PoolMember[] }
export interface PoolConfiguration { campusId: string; version: number; automaticEnabled: boolean; rules: PoolRule[] }
export interface PoolAdministration { campusId: string; version: number; candidates: Array<{ id: string; label: string; activeLeadCount: number }>; counters: Array<{ ruleId: string; userId: string; label: string; assignedCount: number }>; fairnessScope: "CAMPUS_CONFIGURATION_VERSION_RULE_NEW_ENTRANTS" }
export const poolSourceLabels: Record<string, string> = { WEB_FORM: "Formulaire Web", PHONE_CALL: "Appel téléphonique", PHYSICAL_VISIT: "Visite", WEBSITE: "Site Internet", EVENT: "Événement", PARTNER: "Partenaire", JOBINTECH: "Jobintech", LEGACY_IMPORT: "Import historique", MANUAL_ENTRY: "Saisie manuelle", OTHER_CONTROLLED: "Autre source contrôlée" };
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Réponse de configuration invalide."); return v as Record<string, unknown>; }
function count(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0; }
export function poolConfiguration(value: unknown): PoolConfiguration {
  const v = object(value);
  if (typeof v.campusId !== "string" || !count(v.version) || typeof v.automaticEnabled !== "boolean" || !Array.isArray(v.rules) || v.rules.length > 100) throw new Error("Configuration invalide.");
  for (const raw of v.rules) {
    const rule = object(raw);
    if (typeof rule.id !== "string" || !["GLOBAL", "SOURCE", "CAMPAIGN"].includes(String(rule.scope)) || !["ROUND_ROBIN", "CONTROLLED_RANDOM"].includes(String(rule.strategy)) || typeof rule.enabled !== "boolean"
      || rule.balanceNewEntrants !== undefined && typeof rule.balanceNewEntrants !== "boolean" || !Array.isArray(rule.candidates) || rule.candidates.length > 100) throw new Error("Règle invalide.");
    for (const rawMember of rule.candidates) { const member = object(rawMember); if (typeof member.userId !== "string" || typeof member.active !== "boolean" || !count(member.capacity) || member.capacity < 1
      || member.suspended !== undefined && typeof member.suspended !== "boolean" || member.excluded !== undefined && typeof member.excluded !== "boolean") throw new Error("Participant invalide."); }
  }
  return v as unknown as PoolConfiguration;
}
export function poolAdministration(value: unknown): PoolAdministration {
  const v = object(value);
  if (typeof v.campusId !== "string" || !count(v.version) || v.fairnessScope !== "CAMPUS_CONFIGURATION_VERSION_RULE_NEW_ENTRANTS" || !Array.isArray(v.candidates) || !Array.isArray(v.counters)) throw new Error("Compteurs ou conseillers indisponibles.");
  for (const raw of v.candidates) { const row = object(raw); if (typeof row.id !== "string" || typeof row.label !== "string" || !count(row.activeLeadCount)) throw new Error("Conseiller invalide."); }
  for (const raw of v.counters) { const row = object(raw); if (typeof row.ruleId !== "string" || typeof row.userId !== "string" || typeof row.label !== "string" || !count(row.assignedCount)) throw new Error("Compteur invalide."); }
  return v as unknown as PoolAdministration;
}
