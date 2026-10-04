"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../../_components/ui/page-header";
import { admissionsDate, admissionsError, admissionsRequest, admissionsStateLabels, type AdmissionsBooking } from "./admissions-client";
import { AdmissionsBookingActions } from "./booking-actions";
import { appointmentState } from "../appointment-agenda";
import { AdmissionsReportForm } from "./report-form";

export function AdmissionsBookingDetail({ bookingId }: Readonly<{ bookingId: string }>): React.JSX.Element {
  const [booking, setBooking] = useState<AdmissionsBooking>(); const [error, setError] = useState<string>();
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => { const value = await admissionsRequest<AdmissionsBooking>(`/admissions/bookings/${encodeURIComponent(bookingId)}`, signal ? { signal } : undefined); if (!signal?.aborted) { setBooking(value); setError(undefined); } }, [bookingId]);
  const refreshAfterWrite = async (): Promise<void> => { try { await load(); } catch (failure) { setError(`La dernière modification a été confirmée par le serveur, mais la demande n’a pas pu être relue. Actualisez avant toute autre action. ${admissionsError(failure)}`); throw failure; } };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((failure: unknown) => { if (!controller.signal.aborted) setError(admissionsError(failure)); }); return (): void => controller.abort(); }, [load]);
  return <main className="admissions-page"><PageHeader eyebrow="Relation Ynov · décision Admissions" title={booking ? booking.leadLabel || booking.leadIdentifier : "Demande de rendez-vous"} description="Le statut de la demande est relu depuis le serveur, indépendamment d’un accès à la fiche complète du Lead." actions={<Link className="secondary-button" href="/appointments/admissions">Retour à mon agenda</Link>} />
    {error ? <section className="ui-state ui-state--error" role="alert"><h2>Demande indisponible</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load().catch((failure: unknown) => setError(admissionsError(failure)))}>Actualiser</button></section> : null}
    {!booking && !error ? <section className="connected-state" role="status" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Lecture de la demande…</span></section> : null}
    {booking && !error ? <section className="panel admissions-panel"><span className="admissions-state" data-state={booking.state}>{admissionsStateLabels[booking.state]}</span><h2>{admissionsDate(booking.startsAt)} · Casablanca</h2><dl className="admissions-detail"><div><dt>Responsable désigné</dt><dd>{booking.responsibleLabel}</dd></div><div><dt>Campus</dt><dd>{booking.campusLabel ?? "Campus autorisé"}</dd></div><div><dt>Durée</dt><dd>{booking.durationMinutes} minutes</dd></div><div><dt>État Rendez-vous</dt><dd>{appointmentState(booking.appointmentState)}</dd></div></dl><AdmissionsBookingActions booking={booking} onUpdated={refreshAfterWrite} /><AdmissionsReportForm booking={booking} onUpdated={refreshAfterWrite} /><p className="admissions-notice">Une demande réserve provisoirement le créneau. Seule la décision distincte du responsable peut l’accepter ; l’historique existant est conservé.</p></section> : null}
  </main>;
}
