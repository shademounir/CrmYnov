"use client";

import Link from "next/link";
import { ArrowRight, CalendarBlank, CalendarCheck, Clock, UsersThree } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { apiString, resourceObjects, type ApiObject, type ApiValue } from "../_components/connected-resource";

type AgendaState = { kind: "loading" | "ready" | "empty" | "error"; items: ApiObject[] };
type AgendaView = "day" | "week" | "table";

const finalStates = new Set(["ANNULE", "REALISE", "ABSENT", "REFUSE"]);
const stateLabels: Readonly<Record<string, string>> = {
  BROUILLON: "Brouillon", PLANIFIE: "Planifié", CONFIRME: "Confirmé", REPORTE: "Reporté",
  ANNULE: "Annulé", REALISE: "Réalisé", ABSENT: "Absent", REFUSE: "Refusé",
};
const typeLabels: Readonly<Record<string, string>> = {
  APPEL_INFORMATION: "Appel d’information", VISITE_CAMPUS: "Visite du campus", ENTRETIEN_ADMISSION: "Entretien d’admission",
  ENTRETIEN_MOTIVATION: "Entretien de motivation", TEST_ADMISSION: "Test d’admission", RENDEZ_VOUS_DIRECTION: "Rendez-vous direction",
  RENDEZ_VOUS_LIBRE: "Rendez-vous libre",
};
const modeLabels: Readonly<Record<string, string>> = { SUR_SITE: "Sur site", TELEPHONE: "Téléphone", DISTANCIEL_NON_CONNECTE: "À distance" };

export function appointmentDate(value: string): { date: string; time: string } {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return { date: "Date à vérifier", time: "—" };
  return {
    date: new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", weekday: "short", day: "numeric", month: "short" }).format(parsed),
    time: new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit" }).format(parsed),
  };
}

export function appointmentState(value: string): string { return stateLabels[value] ?? "À vérifier"; }

function initialView(): AgendaView {
  if (typeof globalThis.location === "undefined") return "day";
  const view = new URLSearchParams(globalThis.location.search).get("view");
  return view === "week" || view === "table" ? view : "day";
}

function dayKey(date: Date): string {
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function appointmentsForView(items: ApiObject[], view: AgendaView, reference = new Date()): ApiObject[] {
  if (view === "table") return items;
  const referenceKey = dayKey(reference);
  if (view === "day") return items.filter((item) => dayKey(new Date(apiString(item, "startsAt"))) === referenceKey);
  const localReference = new Date(`${referenceKey}T00:00:00Z`);
  localReference.setUTCDate(localReference.getUTCDate() - ((localReference.getUTCDay() + 6) % 7));
  const weekStart = localReference.toISOString().slice(0, 10);
  localReference.setUTCDate(localReference.getUTCDate() + 6);
  const weekEnd = localReference.toISOString().slice(0, 10);
  return items.filter((item) => { const key = dayKey(new Date(apiString(item, "startsAt"))); return key >= weekStart && key <= weekEnd; });
}

export function appointmentAgendaSummary(items: ApiObject[], reference = new Date()): ReadonlyArray<{ label: string; value: number }> {
  const today = dayKey(reference); const active = items.filter((item) => !finalStates.has(apiString(item, "state")));
  return [
    { label: "Aujourd’hui", value: items.filter((item) => dayKey(new Date(apiString(item, "startsAt"))) === today).length },
    { label: "À venir", value: active.filter((item) => new Date(apiString(item, "startsAt")).valueOf() > reference.valueOf()).length },
    { label: "À confirmer", value: active.filter((item) => apiString(item, "state") === "PLANIFIE").length },
    { label: "Confirmés", value: active.filter((item) => apiString(item, "state") === "CONFIRME").length },
  ];
}

function Summary({ items }: Readonly<{ items: ApiObject[] }>): React.JSX.Element {
  const icons = [CalendarBlank, Clock, UsersThree, CalendarCheck];
  const metrics = appointmentAgendaSummary(items).map((metric, index) => ({ ...metric, icon: icons[index]! }));
  return <section className="appointments-summary" aria-label="Repères de l’agenda">{metrics.map(({ label, value, icon: Icon }) => <article key={label}><span><Icon size={18} aria-hidden="true" /></span><div><strong>{value}</strong><small>{label}</small></div></article>)}</section>;
}

function AppointmentTable({ items }: Readonly<{ items: ApiObject[] }>): React.JSX.Element {
  return <div className="appointments-table-wrap"><table aria-label="Rendez-vous persistants">
    <thead><tr><th scope="col">Date et heure</th><th scope="col">Rendez-vous</th><th scope="col">Mode</th><th scope="col">État</th><th scope="col">Campus</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
    <tbody>{items.map((item, index) => { const id = apiString(item, "id"); const state = apiString(item, "state"); const type = apiString(item, "type"); const date = appointmentDate(apiString(item, "startsAt")); return <tr key={id || index}>
      <td data-label="Date et heure"><span className="appointments-date"><strong>{date.date}</strong><small>{date.time} · Casablanca</small></span></td>
      <th scope="row" data-label="Rendez-vous"><span className="appointments-owner"><strong>{typeLabels[type] ?? "Rendez-vous à vérifier"}</strong><small>{apiString(item, "adviserLabel", "Responsable autorisé")}</small></span></th>
      <td data-label="Mode">{modeLabels[apiString(item, "mode")] ?? "À préciser"}</td>
      <td data-label="État"><span className="appointments-state" data-state={state}>{appointmentState(state)}</span></td>
      <td data-label="Campus">{apiString(item, "campus", "À distance")}</td>
      <td data-label="Action">{id ? <Link href={`/appointments/${encodeURIComponent(id)}`} aria-label={`Ouvrir le rendez-vous du ${date.date} à ${date.time}`}><span>Voir</span><ArrowRight size={16} weight="bold" aria-hidden="true" /></Link> : "—"}</td>
    </tr>; })}</tbody>
  </table></div>;
}

export function AppointmentAgenda(): React.JSX.Element {
  const [view, setView] = useState<AgendaView>(initialView); const [state, setState] = useState<AgendaState>({ kind: "loading", items: [] });
  const endpoint = useMemo(() => "/api/crm/appointments?page=1&pageSize=25", []);
  const visibleItems = useMemo(() => appointmentsForView(state.items, view), [state.items, view]);
  const noVisibleAppointment = state.kind === "empty" || (state.kind === "ready" && visibleItems.length === 0);
  useEffect(() => { const controller = new AbortController(); void fetch(endpoint, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`api_${response.status}`); const items = resourceObjects(await response.json() as ApiValue); setState({ kind: items.length ? "ready" : "empty", items }); }).catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setState({ kind: "error", items: [] }); }); return (): void => controller.abort(); }, [endpoint]);
  return <><Summary items={state.items} />
    <nav className="appointments-views" aria-label="Vues agenda">{([["day", "Jour"], ["week", "Semaine"], ["table", "Tableau accessible"]] as const).map(([value, label]) => <Link key={value} href={`?view=${value}`} onClick={() => setView(value)} className={view === value ? "active" : undefined} aria-current={view === value ? "page" : undefined}>{label}</Link>)}</nav>
    <section className="panel appointments-work-panel"><header className="appointments-work-panel__header"><div><p className="eyebrow">Planning du campus</p><h2>{view === "week" ? "Cette semaine" : view === "table" ? "Tous les rendez-vous" : "Aujourd’hui"}</h2></div><span>Heure locale · Casablanca</span></header>
      {state.kind === "loading" ? <section className="connected-state" aria-live="polite" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Chargement depuis l’API locale…</span></section> : null}
      {state.kind === "error" ? <section className="ui-state ui-state--error" role="alert"><h2>Agenda indisponible</h2><p>Les rendez-vous ne sont pas affichés. Vérifiez la session et la disponibilité de l’API locale.</p><button type="button" onClick={() => globalThis.location.reload()}>Réessayer</button></section> : null}
      {noVisibleAppointment ? <section className="appointments-empty" aria-live="polite"><span><CalendarBlank size={24} aria-hidden="true" /></span><div><h2>Aucun rendez-vous dans cette vue</h2><p>Planifiez le prochain échange depuis la fiche du Lead concerné. Aucun calendrier externe n’est sollicité.</p></div><Link className="secondary-button" href="/leads">Ouvrir les Leads <ArrowRight size={17} aria-hidden="true" /></Link></section> : null}
      {state.kind === "ready" && visibleItems.length ? <AppointmentTable items={visibleItems} /> : null}
    </section><p className="appointments-footnote">Les disponibilités restent bornées au périmètre autorisé. L’agenda complet d’un collaborateur n’est jamais exposé.</p></>;
}
