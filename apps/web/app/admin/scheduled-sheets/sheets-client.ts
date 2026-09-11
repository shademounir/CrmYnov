import type { ApiObject, ApiValue } from "../../_components/connected-resource";

export interface SheetSimulation {
  rows: number;
  mapped: number;
  review: number;
  simulated: boolean;
  reconciliationRequired: boolean;
}

export function sheetSimulation(value: ApiValue): SheetSimulation {
  const result = sheetApiObject(value);
  const { rows, mapped, review, simulated, reconciliationRequired } = result;
  const counts = [rows, mapped, review];
  if (counts.some((count) => typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
    || typeof rows !== "number" || typeof mapped !== "number" || typeof review !== "number"
    || mapped + review !== rows || result.mutated !== false || typeof simulated !== "boolean"
    || typeof reconciliationRequired !== "boolean") throw new Error("Résultat de simulation incomplet ou incohérent. Aucune réussite n’a été confirmée.");
  return { rows, mapped, review, simulated, reconciliationRequired };
}

export interface SheetSourceConfiguration {
  mode: "SIMULATED" | "GOOGLE";
  identityMode: "EXTERNAL_ID" | "LOCAL_ROW";
  sheetId: number;
  range: string;
}

export function sheetSourceConfiguration(form: FormData): SheetSourceConfiguration {
  const mode = form.get("sourceMode") === "GOOGLE" ? "GOOGLE" : "SIMULATED";
  const identityMode = form.get("identityMode") === "LOCAL_ROW" ? "LOCAL_ROW" : "EXTERNAL_ID";
  const range = form.get("range");
  return { mode, identityMode, sheetId: Number(form.get("sheetId")), range: typeof range === "string" ? range.trim() : "" };
}

export function sheetApiObject(value: ApiValue | undefined): ApiObject { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
export function sheetApiValue(value: unknown): ApiValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(sheetApiValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sheetApiValue(item)]));
  throw new Error("Réponse du service invalide.");
}
export function sheetError(status: number): string {
  if (status === 401) return "Session expirée. Reconnectez-vous avant de poursuivre.";
  if (status === 403 || status === 404) return "Accès refusé ou connecteur indisponible dans votre périmètre.";
  if (status === 409) return "Conflit de version, exécution active ou autre canal déjà activé. Actualisez avant de réessayer.";
  if (status === 400 || status === 422) return "Configuration refusée. Vérifiez le classeur, la plage, la correspondance des colonnes et les références autorisées.";
  return "Service indisponible. Aucune réussite n’a été confirmée.";
}
export async function sheetRequest(path: string, method = "GET", body?: object): Promise<ApiValue> {
  let response: Response;
  try {
    response = await fetch(`/api/crm/scheduled-sheets${path}`, { method, credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new Error(sheetError(503)); }
  if (!response.ok) throw new Error(sheetError(response.status));
  try { return sheetApiValue(await response.json()); }
  catch { throw new Error("Réponse du service invalide. Aucune réussite n’a été confirmée."); }
}
