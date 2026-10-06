import type { ApiObject, ApiValue } from "../_components/connected-resource";

export const leadWorkViews = [
  ["ALL", "Tous les leads"], ["MINE", "Mes leads"], ["FOLLOW_UP", "À relancer"],
  ["UNASSIGNED", "Non affectés"], ["NO_ACTIVITY", "Sans activité"], ["CLOSED", "Clôturés"],
] as const;

export const leadProvenanceViews = [
  ["FORMINATOR_ZAPIER", "Forminator / Zapier"], ["YNOV_MA_LEGACY", "Ynov.ma historique"],
  ["YNOV_COM", "Ynov.com"], ["PHONE_CALLS", "Appels"], ["PHYSICAL_VISITS", "Visites"],
  ["JOBINTECH", "JobInTech"], ["LEGACY_RELAUNCH", "Relances historiques"],
  ["UNCLASSIFIED_SOURCES", "Sources non classifiées"], ["INCOMPLETE", "À compléter"],
] as const;

export const leadListFilterLabels: Readonly<Record<string, string>> = {
  search: "Recherche", assignedToId: "Conseiller principal", collaboratorId: "Collaborateur",
  adviserId: "Conseiller impliqué", status: "Statut", temperature: "Température", source: "Source",
  channel: "Canal", program: "Formation", campaign: "Campagne", campus: "Campus",
  createdFrom: "Créés à partir du", createdTo: "Créés jusqu’au", createdBefore: "Créés avant le",
  assignmentMode: "Mode d’affectation", importBatchId: "Lot d’import", view: "File",
  savedView: "Provenance", sharedViewId: "Vue partagée",
};

/** Changing a filter starts at page one; unrelated URL context is kept intact. */
export function leadListHref(current: URLSearchParams, changes: Readonly<Record<string, string | null>>, resetPage = true): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  if (resetPage) next.set("page", "1");
  const query = next.toString();
  return `/leads${query ? `?${query}` : ""}`;
}

export function leadListResetHref(current: URLSearchParams): string {
  return leadListHref(current, Object.fromEntries(Object.keys(leadListFilterLabels).map((key) => [key, null])));
}

export function leadListFilterValue(key: string, value: string): string {
  const choices: Record<string, string> = {
    ...Object.fromEntries(leadWorkViews), ...Object.fromEntries(leadProvenanceViews),
    IMPORT_ERRORS: "Imports en erreur — indisponibles", PROSPECT: "Prospect", CONTACTED: "Contacté",
    QUALIFIED: "Qualifié", ENROLLED: "Inscrit", CLOSED_LOST: "Sans suite", UNEVALUATED: "Non évalué",
    COLD: "Froid", WARM: "Tiède", HOT: "Chaud", DIGITAL: "Digital", PHONE: "Téléphone",
    IN_PERSON: "Présentiel", PARTNER: "Partenaire", OTHER: "Autre",
  };
  if (["assignedToId", "collaboratorId", "adviserId", "importBatchId", "sharedViewId"].includes(key)) return "Filtre actif";
  return choices[value] ?? value;
}

export interface LeadListPage { items: ApiObject[]; page: number; pageSize: number; total: number }

/** A missing server total is not an empty result and must not become a fabricated count. */
export function readLeadListPage(value: ApiValue): LeadListPage {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.items)) throw new Error("lead_list_contract_invalid");
  const { page, pageSize, total } = value;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1
    || typeof pageSize !== "number" || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) throw new Error("lead_list_contract_invalid");
  const items = value.items.filter((item): item is ApiObject => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (items.length !== value.items.length || items.length > pageSize || total < items.length
    || (items.length > 0 && (page - 1) * pageSize + items.length > total)) throw new Error("lead_list_contract_invalid");
  return { items, page, pageSize, total };
}

export type LeadListFailure = "session" | "forbidden" | "unavailable" | "network" | "invalid" | "error";
export function leadListFailureForStatus(status: number): LeadListFailure {
  if (status === 401) return "session";
  if (status === 403) return "forbidden";
  if (status === 503) return "unavailable";
  if (status === 400 || status === 422) return "invalid";
  return "error";
}
