"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdmissionsApiError, admissionsCampusLabel, admissionsDate, admissionsError, admissionsRequest, admissionsStateLabels, type AdmissionsBooking, type AdmissionsBookingsPage, type AdmissionsContext, type AdmissionsResponsibility, type AdmissionsWindow } from "./admissions-client";
import { AdmissionsBookingActions } from "./booking-actions";
import { AdmissionsResponsibilities, AdmissionsWindowForm, AdmissionsWindows } from "./agenda-forms";

type AgendaData = { context: AdmissionsContext; bookings: AdmissionsBooking[]; hasMore: boolean; nextCursor?: string | undefined; windows: AdmissionsWindow[]; responsibilities: AdmissionsResponsibility[] };
export function AdmissionsAgenda(): React.JSX.Element {
  const [data, setData] = useState<AgendaData>(); const [error, setError] = useState<string>(); const [refreshing, setRefreshing] = useState(false); const [filter, setFilter] = useState("PENDING");
  const [pageBusy, setPageBusy] = useState(false); const paging = useRef(false); const generation = useRef(0);
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const version = ++generation.current;
    const context = await admissionsRequest<AdmissionsContext>("/admissions/context", signal ? { signal } : undefined);
    const [bookings, windows, responsibilities] = await Promise.all([
      admissionsRequest<AdmissionsBookingsPage>("/admissions/bookings?limit=50", signal ? { signal } : undefined),
      context.ownResponsibilities.length || context.canManageResponsibilities ? admissionsRequest<{ items: AdmissionsWindow[] }>("/admissions/windows", signal ? { signal } : undefined) : Promise.resolve({ items: [] }),
      context.canManageResponsibilities ? admissionsRequest<{ items: AdmissionsResponsibility[] }>("/admissions/responsibles", signal ? { signal } : undefined) : Promise.resolve({ items: [] }),
    ]);
    if (!signal?.aborted && version === generation.current) { setData({ context, bookings: bookings.items, hasMore: bookings.hasMore === true, ...(bookings.nextCursor ? { nextCursor: bookings.nextCursor } : {}), windows: windows.items, responsibilities: responsibilities.items }); setError(undefined); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((failure: unknown) => { if (!controller.signal.aborted) setError(admissionsError(failure)); }); return (): void => controller.abort(); }, [load]);
  const refresh = async (): Promise<void> => { setRefreshing(true); try { await load(); } catch (failure) { setError(admissionsError(failure)); if (failure instanceof AdmissionsApiError && [401, 403].includes(failure.status)) setData(undefined); throw failure; } finally { setRefreshing(false); } };
  const more = async (): Promise<void> => {
    if (!data?.nextCursor || !data.hasMore || paging.current || refreshing) return;
    const version = generation.current; paging.current = true; setPageBusy(true);
    try {
      const page = await admissionsRequest<AdmissionsBookingsPage>(`/admissions/bookings?${new URLSearchParams({ limit: "50", cursor: data.nextCursor })}`);
      setData((current) => {
        if (!current || version !== generation.current) return current;
        const byId = new Map([...current.bookings, ...page.items].map((booking) => [booking.id, booking]));
        return { ...current, bookings: [...byId.values()], hasMore: page.hasMore === true, nextCursor: page.nextCursor };
      });
    } catch (failure) { setError(admissionsError(failure)); if (failure instanceof AdmissionsApiError && [401, 403].includes(failure.status)) setData(undefined); }
    finally { paging.current = false; setPageBusy(false); }
  };
  if (!data) return error ? <section className="ui-state ui-state--error" role="alert"><h2>Agenda Admissions indisponible</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => void refresh().catch(() => undefined)}>Réessayer</button></section> : <section className="connected-state" aria-busy="true" role="status"><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Chargement de l’agenda Admissions…</span></section>;
  const visible = data.bookings.filter((item) => filter === "ALL" || item.state === filter);
  return <>
    {error ? <p className="admissions-error" role="alert">{error} Les données affichées précédemment ne prouvent pas que vos droits sont toujours valides.</p> : null}
    <section className="admissions-overview" aria-label="Repères Admissions"><article><strong>{data.bookings.filter((item) => item.state === "PENDING").length}</strong><span>Demandes en attente chargées</span></article><article><strong>{data.bookings.filter((item) => item.state === "ACCEPTED").length}</strong><span>Rendez-vous acceptés chargés</span></article><article><strong>{data.windows.filter((item) => item.active && item.kind === "AVAILABLE").length}</strong><span>Plages de disponibilité</span></article></section>
    <div className="admissions-agenda-grid"><AdmissionsWindowForm responsibilities={data.context.ownResponsibilities.filter((item) => item.active)} onUpdated={refresh} /><AdmissionsWindows items={data.windows} context={data.context} onUpdated={refresh} /></div>
    <section className="panel admissions-panel admissions-requests"><div className="admissions-section-heading"><div><p className="eyebrow">Demande et décision distinctes</p><h2>Mes rendez-vous et demandes</h2><p>Demandes reçues comme responsable et demandes envoyées dans votre périmètre.</p></div><button type="button" className="secondary-button" disabled={refreshing} onClick={() => void refresh().catch(() => undefined)}>{refreshing ? "Actualisation…" : "Actualiser l’agenda"}</button></div>
      <label className="admissions-filter">État affiché<select name="bookingState" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="PENDING">En attente du responsable</option><option value="ACCEPTED">Acceptés</option><option value="REFUSED">Refusés</option><option value="CANCELLED">Annulés</option><option value="ALL">Tous les états</option></select></label>
      {visible.length ? <ul className="admissions-booking-list">{visible.map((booking) => <li key={booking.id}><article><div className="admissions-section-heading"><div><span className="admissions-state" data-state={booking.state}>{admissionsStateLabels[booking.state]}</span><h3>{booking.leadLabel || booking.leadIdentifier}</h3><p>{admissionsDate(booking.startsAt)} · {booking.durationMinutes} minutes</p><p>{booking.responsibleLabel} · {booking.campusLabel ?? admissionsCampusLabel(booking.campus, data.context)}</p></div><Link className="secondary-button" href={`/appointments/admissions/${encodeURIComponent(booking.id)}`}>Ouvrir la demande</Link></div><AdmissionsBookingActions booking={booking} onUpdated={refresh} /></article></li>)}</ul> : <p className="admissions-notice" role="status">Aucune demande dans cet état parmi les demandes chargées. Les nouveaux rendez-vous se demandent depuis la fiche du Lead.</p>}
      {data.hasMore ? <div className="admissions-actions"><p role="status">D’autres demandes autorisées restent à charger. Les compteurs portent uniquement sur les demandes chargées.</p><button className="secondary-button" type="button" onClick={() => void more()} disabled={pageBusy || refreshing || !data.nextCursor}>{pageBusy ? "Chargement…" : "Charger d’autres demandes"}</button></div> : null}
    </section>
    <AdmissionsResponsibilities context={data.context} items={data.responsibilities} onUpdated={refresh} />
  </>;
}
