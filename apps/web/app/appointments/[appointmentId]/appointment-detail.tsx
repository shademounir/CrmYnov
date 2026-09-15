"use client";

import Link from "next/link";
import { ArrowLeft, CalendarCheck, Clock, ShieldCheck, UserCircle, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { appointmentDate, appointmentState } from "../appointment-agenda";
import { AppointmentStateActions } from "./appointment-state-actions";

interface AppointmentRecord {
  id: string; leadId: string; type: string; mode: string; state: string; startsAt: string;
  durationMinutes: number; campus?: string; adviserId: string; adviserLabel?: string; organizerId: string; organizerLabel?: string;
  version: number; conflictWarning: boolean; overloadWarning: boolean;
}
interface AppointmentEvent { id: string; type: string; occurredAt: string; reasonCode?: string }
interface AppointmentPayload { appointment: AppointmentRecord; events: AppointmentEvent[] }
type DetailState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; payload: AppointmentPayload };

const typeLabels: Readonly<Record<string, string>> = {
  APPEL_INFORMATION: "Appel d’information", VISITE_CAMPUS: "Visite du campus", ENTRETIEN_ADMISSION: "Entretien d’admission",
  ENTRETIEN_MOTIVATION: "Entretien de motivation", TEST_ADMISSION: "Test d’admission", RENDEZ_VOUS_DIRECTION: "Rendez-vous direction",
  RENDEZ_VOUS_LIBRE: "Rendez-vous libre",
};
const modeLabels: Readonly<Record<string, string>> = { SUR_SITE: "Sur site", TELEPHONE: "Téléphone", DISTANCIEL_NON_CONNECTE: "À distance" };
const eventLabels: Readonly<Record<string, string>> = {
  APPOINTMENT_CREATED: "Rendez-vous créé",
  APPOINTMENT_CONFIRME: "Rendez-vous confirmé",
  APPOINTMENT_REPORTE: "Rendez-vous reporté",
  APPOINTMENT_REALISE: "Rendez-vous réalisé",
  APPOINTMENT_ABSENT: "Absence constatée",
  APPOINTMENT_ANNULE: "Rendez-vous annulé",
  APPOINTMENT_REFUSE: "Rendez-vous refusé",
  APPOINTMENT_CONFIRMED: "Rendez-vous confirmé",
  APPOINTMENT_COMPLETED: "Rendez-vous réalisé",
  APPOINTMENT_NO_SHOW: "Absence constatée",
  APPOINTMENT_CANCELLED: "Rendez-vous annulé",
  APPOINTMENT_COMPENSATION: "Correction tracée",
  INTERVIEW_REPORT_VALIDATED: "Compte rendu validé",
};
export function appointmentEventLabel(type: string): string { return eventLabels[type] ?? "Événement du rendez-vous"; }
export function appointmentEventReason(reasonCode?: string): string | undefined { const reason = reasonCode?.trim(); return reason ? `Motif : ${reason}` : undefined; }
export const appointmentPrivacyNotice = "Les participants autorisés ne révèlent que leurs créneaux occupés. L’agenda complet n’est jamais exposé.";

export function AppointmentDetail({ appointmentId }: Readonly<{ appointmentId: string }>): React.JSX.Element {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const response = await fetch(`/api/crm/appointments/${encodeURIComponent(appointmentId)}`, { cache: "no-store", credentials: "same-origin", ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error("appointment_unavailable");
    setState({ kind: "ready", payload: await response.json() as AppointmentPayload });
  }, [appointmentId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setState({ kind: "error" }); });
    return (): void => controller.abort();
  }, [load]);

  if (state.kind === "loading") return <main className="appointment-detail-page"><section className="connected-state" aria-live="polite" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Chargement depuis l’API locale…</span></section></main>;
  if (state.kind === "error") return <main className="appointment-detail-page"><Link className="lead-profile__back" href="/appointments?view=table"><ArrowLeft size={17} /> Retour aux rendez-vous</Link><section className="ui-state ui-state--error" role="alert"><h1>Rendez-vous indisponible</h1><p>Il n’existe pas ou n’est pas visible dans votre périmètre.</p><button type="button" onClick={() => globalThis.location.reload()}>Réessayer</button></section></main>;

  const { appointment, events } = state.payload;
  const date = appointmentDate(appointment.startsAt);
  return <main className="appointment-detail-page">
    <Link className="lead-profile__back" href="/appointments?view=table"><ArrowLeft size={17} aria-hidden="true" /> Retour aux rendez-vous</Link>
    <header className="appointment-detail-page__header"><div><p className="eyebrow">Relation Ynov · agenda CRM</p><h1>{typeLabels[appointment.type] ?? "Rendez-vous"}</h1><p>{date.date} à {date.time} · heure de Casablanca</p></div><span className="appointments-state" data-state={appointment.state}>{appointmentState(appointment.state)}</span></header>
    <section className="appointments-summary appointment-detail-page__summary" aria-label="Détails du rendez-vous">
      <article><span><Clock size={18} /></span><div><strong>{appointment.durationMinutes} min</strong><small>Durée</small></div></article>
      <article><span><CalendarCheck size={18} /></span><div><strong>{modeLabels[appointment.mode] ?? "À préciser"}</strong><small>Mode</small></div></article>
      <article><span><ShieldCheck size={18} /></span><div><strong>{appointment.campus ?? "À distance"}</strong><small>Périmètre</small></div></article>
      <article><span><UserCircle size={18} /></span><div><strong>{appointment.adviserLabel ?? "Responsable autorisé"}</strong><small>Conseiller responsable</small></div></article>
      <article><span><WarningCircle size={18} /></span><div><strong>{appointment.conflictWarning ? "À vérifier" : "Aucun signal"}</strong><small>Conflit</small></div></article>
    </section>
    <AppointmentStateActions appointment={appointment} onUpdated={() => load()} />
    <div className="appointment-detail-page__grid">
      <section className="panel"><p className="eyebrow">Historique protégé</p><h2>Chronologie immuable</h2>{events.length ? <ol>{events.map((event) => { const reason = appointmentEventReason(event.reasonCode); return <li key={event.id}><time dateTime={event.occurredAt}>{appointmentDate(event.occurredAt).date} · {appointmentDate(event.occurredAt).time}</time><strong>{appointmentEventLabel(event.type)}</strong>{reason ? <span>{reason}</span> : null}</li>; })}</ol> : <p>Aucun événement visible.</p>}</section>
      <aside className="panel"><p className="eyebrow">Confidentialité</p><h2>Disponibilités bornées</h2><p>{appointmentPrivacyNotice}</p><p>Une correction ajoute un événement compensatoire : aucun historique n’est effacé.</p><Link className="secondary-button" href={`/leads/${encodeURIComponent(appointment.leadId)}`}>Ouvrir la fiche Lead</Link></aside>
    </div>
  </main>;
}
