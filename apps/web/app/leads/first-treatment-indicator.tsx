import React from "react";
import type { ApiObject } from "../_components/connected-resource";

/** The server owns the threshold and reception clock; rendering never resets
 * reception or derives a fresh SLA from the browser's local time. */
export function firstTreatmentAge(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "ancienneté indisponible";
  const hours = Math.floor(value / 60);
  const days = Math.floor(hours / 24);
  return days ? `${days} j ${hours % 24} h` : `${hours} h ${Math.floor(value % 60)} min`;
}

export function FirstTreatmentIndicator({ lead }: Readonly<{ lead: ApiObject }>): React.JSX.Element | null {
  if (lead.firstTreatmentOverdue !== true) return null;
  const reception = lead.receptionOrigin === "SOURCE_CONTRACT" ? "Réception source reconnue"
    : lead.receptionOrigin === "CRM_OBSERVATION_BASELINE" ? "Réception CRM du portefeuille historique" : "Première réception CRM";
  return <span className="first-treatment-overdue"><strong>Premier traitement en retard</strong><small>{reception} · {firstTreatmentAge(lead.firstTreatmentAgeMinutes)}</small><small>Strictement plus de 24 h consécutives · aucun traitement commercial connu</small></span>;
}
