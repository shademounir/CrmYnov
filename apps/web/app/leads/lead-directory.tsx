"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, CalendarBlank } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { apiString, type ApiObject, type ApiValue } from "../_components/connected-resource";
import { leadListFailureForStatus, leadListHref, readLeadListPage, type LeadListFailure, type LeadListPage } from "./lead-list-query";

const statusLabels: Readonly<Record<string, string>> = {
  PROSPECT: "Prospect",
  CONTACTED: "Contacté",
  QUALIFIED: "Qualifié",
  ENROLLED: "Inscrit",
  CLOSED_LOST: "Sans suite",
};

function validNamePart(value: string): string {
  const normalized = value.normalize("NFC").trim();
  return /\p{L}/u.test(normalized) ? leadDirectoryLabel(normalized, "") : "";
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

const sourceLabels: Readonly<Record<string, string>> = {
  WEB_FORM: "Formulaire web", WEBSITE: "Site web", FORMINATOR_ZAPIER: "Forminator / Zapier",
  LEGACY_IMPORT: "Ynov.ma historique", YNOV_COM: "Ynov.com", PHONE_CALL: "Appel téléphonique",
  PHYSICAL_VISIT: "Visite", JOBINTECH: "JobInTech", LEGACY_RELAUNCH: "Relance historique",
  EVENT: "Événement", PARTNER: "Partenaire", UNKNOWN: "Source non classifiée",
};

export function leadDirectoryLabel(value: string, fallback: string): string {
  return !value.trim() || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(value) ? fallback : value;
}

function LeadDate({ value, empty }: Readonly<{ value: string; empty: string }>): React.JSX.Element {
  return value ? <time dateTime={value}>{followUpDate(value)}</time> : <span>{empty}</span>;
}

export function LeadDirectoryTable({ items, ariaLabel, context = "directory", total = items.length }: Readonly<{ items: ApiObject[]; ariaLabel: string; context?: "directory" | "follow-up"; total?: number }>): React.JSX.Element {
  const followUp = context === "follow-up";
  return <section className={`lead-directory${followUp ? " lead-directory--follow-up" : ""}`} aria-label={`${items.length} prospects affichés sur ${total}`}>
    <header className="lead-directory__summary">
      <span aria-hidden="true">{items.length}</span>
      <div><strong>{items.length > 1 ? "prospects affichés" : "prospect affiché"} sur {total}</strong><small>Total renvoyé par le serveur dans votre périmètre · Dates en heure de Casablanca</small></div>
    </header>
    <div className="lead-directory__table-wrap" role="region" tabIndex={0} aria-label="Tableau des leads, défilement horizontal si nécessaire">
      <table aria-label={ariaLabel}>
        <thead><tr><th scope="col">Prospect</th><th scope="col">{followUp ? "Échéance" : "Situation"}</th><th scope="col">Formation / campus</th><th scope="col">Source</th><th scope="col">Conseiller</th><th scope="col">Dernière activité</th>{!followUp ? <th scope="col">Prochaine action</th> : null}<th scope="col"><span className="sr-only">Action</span></th></tr></thead>
        <tbody>{items.map((item, index) => {
          const id = apiString(item, "id");
          const code = leadDirectoryLabel(apiString(item, "leadCode"), `Lead ${index + 1}`);
          const status = apiString(item, "status", "UNKNOWN");
          const temperature = apiString(item, "temperature", "UNEVALUATED");
          const temperatureLabel = leadDirectoryLabel(apiString(item, "temperatureLabel"), "Non évalué");
          const program = leadDirectoryLabel(apiString(item, "program"), "Formation à préciser");
          const campus = leadDirectoryLabel(apiString(item, "campus"), "Campus à préciser");
          const source = apiString(item, "source");
          const sourceLabel = leadDirectoryLabel(sourceLabels[source] ?? source, "Source à préciser");
          const assigned = Boolean(apiString(item, "assignedToId"));
          const adviser = assigned ? leadDirectoryLabel(apiString(item, "assignedToLabel"), "Affecté · nom indisponible") : "Non affecté";
          const nextActionAt = apiString(item, "nextActionAt");
          const lastActivityAt = apiString(item, "lastActivityAt");
          return <tr key={id || code}>
            <th scope="row" data-label="Prospect"><span className="lead-directory__person">
              <span className="lead-directory__avatar" aria-hidden="true">{leadDirectoryInitials(item)}</span>
              <span className="lead-directory__identity"><strong><LeadName item={item} /></strong><small>{code}</small></span>
            </span></th>
            {followUp ? <td className="lead-directory__situation lead-directory__due" data-label="Échéance"><CalendarBlank size={17} aria-hidden="true" /><span><strong><LeadDate value={nextActionAt} empty="Échéance indisponible" /></strong><small>À traiter</small></span></td> : <td className="lead-directory__situation" data-label="Situation">
              <span className="lead-directory__status" data-status={status}>{leadDirectoryStatus(status)}</span>
              <span className="lead-directory__temperature" data-temperature={temperature}><i aria-hidden="true" />{temperatureLabel}</span>
            </td>}
            <td className="lead-directory__program" data-label="Formation / campus"><span>{program}</span><small>{campus}</small></td>
            <td className="lead-directory__source" data-label="Source">{sourceLabel}</td>
            <td className="lead-directory__assignment" data-label="Conseiller"><span data-assigned={assigned ? "true" : "false"}>{adviser}</span></td>
            <td className="lead-directory__last-activity" data-label="Dernière activité"><LeadDate value={lastActivityAt} empty="Aucune activité enregistrée" /></td>
            {!followUp ? <td className="lead-directory__next-action" data-label="Prochaine action"><LeadDate value={nextActionAt} empty="Non planifiée" /></td> : null}
            <td className="lead-directory__action" data-label="Action">{id ? <Link href={`/leads/${encodeURIComponent(id)}`} aria-label={`Ouvrir la fiche ${code}`}><span>Voir</span><ArrowRight size={16} weight="bold" aria-hidden="true" /></Link> : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

export function LeadListPagination({ result, current }: Readonly<{ result: LeadListPage; current: URLSearchParams }>): React.JSX.Element {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const first = result.items.length ? (result.page - 1) * result.pageSize + 1 : 0;
  const last = result.items.length ? first + result.items.length - 1 : 0;
  const href = (page: number): string => leadListHref(current, { page: String(page), pageSize: String(result.pageSize) }, false);
  return <nav className="lead-list-pagination" aria-label="Pagination des leads">
    <p aria-live="polite">{first}–{last} sur {result.total} résultat{result.total === 1 ? "" : "s"} · Page {result.page} sur {pages}</p>
    <div>{result.page > 1 ? <Link className="secondary-button" prefetch={false} href={href(result.page - 1)} rel="prev">Précédente</Link> : <button className="secondary-button" type="button" disabled>Précédente</button>}
      {result.page < pages ? <Link className="secondary-button" prefetch={false} href={href(result.page + 1)} rel="next">Suivante</Link> : <button className="secondary-button" type="button" disabled>Suivante</button>}</div>
  </nav>;
}

type DirectoryState = { kind: "loading" } | { kind: "ready"; result: LeadListPage } | { kind: LeadListFailure };
const failureMessages: Readonly<Record<LeadListFailure, { title: string; message: string }>> = {
  session: { title: "Session expirée", message: "Reconnectez-vous pour consulter les leads. Les filtres restent conservés dans l’URL." },
  forbidden: { title: "Accès refusé", message: "Vos permissions ou votre périmètre ne permettent pas de consulter cette liste. Aucun lead n’est affiché." },
  unavailable: { title: "Service CRM indisponible", message: "Le service a répondu 503. Aucun résultat n’a pu être confirmé ; réessayez plus tard." },
  network: { title: "Connexion réseau impossible", message: "Le service CRM n’a pas pu être joint. Vérifiez la connexion avant de réessayer." },
  invalid: { title: "Filtres non valides", message: "Vérifiez les filtres, les dates et la pagination. L’API n’a pas accepté cette recherche." },
  error: { title: "Liste indisponible", message: "Le serveur n’a pas fourni une liste valide. Aucun résultat ou total ne peut être confirmé." },
};

export function LeadDirectory({ endpoint, ariaLabel, emptyMessage, context = "directory" }: Readonly<{ endpoint: string; ariaLabel: string; emptyMessage: string; context?: "directory" | "follow-up" }>): React.JSX.Element {
  const [state, setState] = useState<DirectoryState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetch(endpoint, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (!response.ok) { setState({ kind: leadListFailureForStatus(response.status) }); return; }
        try {
          const result = readLeadListPage(await response.json() as ApiValue);
          if (!controller.signal.aborted) setState({ kind: "ready", result });
        } catch { if (!controller.signal.aborted) setState({ kind: "error" }); }
      })
      .catch(() => { if (!controller.signal.aborted) setState({ kind: "network" }); });
    return (): void => controller.abort();
  }, [endpoint, retry]);

  if (state.kind === "loading") return <section className="connected-state" aria-live="polite" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Chargement des prospects depuis l’API locale…</span></section>;
  if (state.kind !== "ready") {
    const failure = failureMessages[state.kind];
    return <section className="ui-state ui-state--error" role="alert"><h2>{failure.title}</h2><p>{failure.message}</p>{state.kind === "session" ? <Link className="secondary-button" href="/">Se reconnecter</Link> : <button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Réessayer</button>}</section>;
  }
  const current = new URL(endpoint, "http://crm.local").searchParams;
  return <>{state.result.items.length ? <LeadDirectoryTable items={state.result.items} total={state.result.total} ariaLabel={ariaLabel} context={context} />
    : <section className="ui-state" aria-live="polite"><h2>{state.result.total > 0 ? "Aucun résultat sur cette page" : "Aucun résultat"}</h2><p>{state.result.total > 0 ? "D’autres pages contiennent des résultats. Revenez à la première page pour les consulter." : emptyMessage}</p>{state.result.total > 0 ? <Link className="secondary-button" href={leadListHref(current, { page: "1" }, false)}>Première page</Link> : null}</section>}
    <LeadListPagination result={state.result} current={current} /></>;
}
