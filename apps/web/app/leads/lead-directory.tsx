"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, CalendarBlank } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { apiString, resourceObjects, type ApiObject, type ApiValue } from "../_components/connected-resource";

const statusLabels: Readonly<Record<string, string>> = {
  PROSPECT: "Prospect",
  CONTACTED: "Contacté",
  QUALIFIED: "Qualifié",
  ENROLLED: "Inscrit",
  CLOSED_LOST: "Sans suite",
};

function validNamePart(value: string): string {
  const normalized = value.normalize("NFC").trim();
  return /\p{L}/u.test(normalized) ? normalized : "";
}

export function leadDirectoryNameParts(item: ApiObject): string[] {
  return [apiString(item, "firstName"), apiString(item, "lastName")].map(validNamePart).filter(Boolean);
}

export function leadDirectoryStatus(status: string): string {
  return statusLabels[status] ?? "À vérifier";
}

export function leadDirectoryInitials(item: ApiObject): string {
  const parts = leadDirectoryNameParts(item);
  return parts.slice(0, 2).map((part) => Array.from(part)[0]?.toLocaleUpperCase("fr") ?? "").join("") || "?";
}

export function followUpDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Date à vérifier";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Casablanca",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function LeadName({ item }: Readonly<{ item: ApiObject }>): React.JSX.Element {
  const parts = leadDirectoryNameParts(item);
  if (!parts.length) return <>Prospect à vérifier</>;
  return <>{parts.map((part, index) => <span key={`${part}-${index}`}>{index ? " " : null}<bdi dir="auto">{part}</bdi></span>)}</>;
}

export function LeadDirectoryTable({ items, ariaLabel, context = "directory" }: Readonly<{ items: ApiObject[]; ariaLabel: string; context?: "directory" | "follow-up" }>): React.JSX.Element {
  const followUp = context === "follow-up";
  return <section className={`lead-directory${followUp ? " lead-directory--follow-up" : ""}`} aria-label={`${items.length} prospects affichés`}>
    <header className="lead-directory__summary">
      <span aria-hidden="true">{items.length}</span>
      <div><strong>{items.length > 1 ? "prospects" : "prospect"}</strong><small>Résultats visibles dans votre périmètre</small></div>
    </header>
    <div className="lead-directory__table-wrap">
      <table aria-label={ariaLabel}>
        <colgroup><col className="lead-directory__col-person" /><col className="lead-directory__col-situation" /><col className="lead-directory__col-program" /><col className="lead-directory__col-assignment" /><col className="lead-directory__col-action" /></colgroup>
        <thead><tr><th scope="col">Prospect</th><th scope="col">{followUp ? "Échéance" : "Situation"}</th><th scope="col">Formation</th><th scope="col">Affectation</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
        <tbody>{items.map((item, index) => {
          const id = apiString(item, "id");
          const code = apiString(item, "leadCode", `Lead ${index + 1}`);
          const status = apiString(item, "status", "UNKNOWN");
          const temperature = apiString(item, "temperature", "UNEVALUATED");
          const temperatureLabel = apiString(item, "temperatureLabel", "Non évalué");
          const program = apiString(item, "program", "Formation à préciser");
          const assigned = Boolean(apiString(item, "assignedToId"));
          const nextActionAt = apiString(item, "nextActionAt");
          return <tr key={id || code}>
            <th scope="row" data-label="Prospect"><span className="lead-directory__person">
              <span className="lead-directory__avatar" aria-hidden="true">{leadDirectoryInitials(item)}</span>
              <span className="lead-directory__identity"><strong><LeadName item={item} /></strong><small>{code}</small></span>
            </span></th>
            {followUp ? <td className="lead-directory__situation lead-directory__due" data-label="Échéance"><CalendarBlank size={17} aria-hidden="true" /><span><strong>{followUpDate(nextActionAt)}</strong><small>À traiter</small></span></td> : <td className="lead-directory__situation" data-label="Situation">
              <span className="lead-directory__status" data-status={status}>{leadDirectoryStatus(status)}</span>
              <span className="lead-directory__temperature" data-temperature={temperature}><i aria-hidden="true" />{temperatureLabel}</span>
            </td>}
            <td className="lead-directory__program" data-label="Formation"><span title={program}>{program}</span></td>
            <td className="lead-directory__assignment" data-label="Affectation"><span data-assigned={assigned ? "true" : "false"}>{assigned ? "Affecté" : "Non affecté"}</span></td>
            <td className="lead-directory__action" data-label="Action">{id ? <Link href={`/leads/${encodeURIComponent(id)}`} aria-label={`Ouvrir la fiche ${code}`}><span>Voir</span><ArrowRight size={16} weight="bold" aria-hidden="true" /></Link> : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

export function LeadDirectory({ endpoint, ariaLabel, emptyMessage, context = "directory" }: Readonly<{ endpoint: string; ariaLabel: string; emptyMessage: string; context?: "directory" | "follow-up" }>): React.JSX.Element {
  const [state, setState] = useState<{ kind: "loading" | "ready" | "empty" | "error"; items: ApiObject[] }>({ kind: "loading", items: [] });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading", items: [] });
    void fetch(endpoint, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`api_${response.status}`);
        const items = resourceObjects(await response.json() as ApiValue);
        setState({ kind: items.length ? "ready" : "empty", items });
      })
      .catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setState({ kind: "error", items: [] }); });
    return (): void => controller.abort();
  }, [endpoint]);

  if (state.kind === "loading") return <section className="connected-state" aria-live="polite" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Chargement des prospects depuis l’API locale…</span></section>;
  if (state.kind === "error") return <section className="ui-state ui-state--error" role="alert"><h2>Connexion impossible</h2><p>Les prospects ne sont pas affichés. Vérifiez la session et la disponibilité de l’API locale.</p><button type="button" onClick={() => globalThis.location.reload()}>Réessayer</button></section>;
  if (state.kind === "empty") return <section className="ui-state" aria-live="polite"><h2>Aucun résultat</h2><p>{emptyMessage}</p></section>;
  return <LeadDirectoryTable items={state.items} ariaLabel={ariaLabel} context={context} />;
}
