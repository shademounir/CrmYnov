"use client";
import Link from "next/link";
import { ArrowLeft, CalendarBlank, CheckCircle, ShieldCheck } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { LeadProfileRecord } from "../../leads/[leadId]/lead-profile";
import { admissionsCampusLabel, admissionsDate, admissionsError, admissionsRequest, admissionsStateLabels, appointmentDurationOptions, sameAttempt, type AdmissionsBooking, type AdmissionsBookingsPage, type AdmissionsContext, type AdmissionsResponsibility } from "./admissions-client";
import { AdmissionsSlotPicker } from "./slot-picker";
type LoadState = { kind: "loading" } | { kind: "ready"; lead: LeadProfileRecord; context: AdmissionsContext; responsibilities: AdmissionsResponsibility[]; bookings: AdmissionsBooking[]; hasMore: boolean; nextCursor?: string | undefined } | { kind: "error"; message: string };

export function AdmissionsBookingForm({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [responsibilityId, setResponsibilityId] = useState(""); const [durationMinutes, setDuration] = useState(30); const [startsAt, setStartsAt] = useState("");
  const [type, setType] = useState("ENTRETIEN_ADMISSION"); const [mode, setMode] = useState("SUR_SITE"); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [pageBusy, setPageBusy] = useState(false); const paging = useRef(false); const [pageError, setPageError] = useState<string>();
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string; booking?: AdmissionsBooking }>();
  const inFlight = useRef(false); const attempt = useRef<{ key: string; payload: string } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([admissionsRequest<LeadProfileRecord>(`/leads/${encodeURIComponent(leadId)}`, { signal: controller.signal }), admissionsRequest<AdmissionsContext>("/admissions/context", { signal: controller.signal }), admissionsRequest<{ items: AdmissionsResponsibility[] }>(`/admissions/responsibles?${new URLSearchParams({ leadId })}`, { signal: controller.signal }), admissionsRequest<AdmissionsBookingsPage>(`/admissions/bookings?${new URLSearchParams({ leadId, limit: "50" })}`, { signal: controller.signal })]).then(([lead, context, responsibilities, bookings]) => { if (!controller.signal.aborted) setLoad({ kind: "ready", lead, context, responsibilities: responsibilities.items.filter((item) => item.active), bookings: bookings.items, hasMore: bookings.hasMore === true, ...(bookings.nextCursor ? { nextCursor: bookings.nextCursor } : {}) }); }).catch((error: unknown) => { if (!controller.signal.aborted) setLoad({ kind: "error", message: admissionsError(error) }); });
    return (): void => controller.abort();
  }, [leadId]);
  useEffect(() => { const prevent = (event: BeforeUnloadEvent): void => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; globalThis.addEventListener("beforeunload", prevent); return (): void => globalThis.removeEventListener("beforeunload", prevent); }, [dirty]);
  const leave = (event: React.MouseEvent<HTMLAnchorElement>): void => { if (dirty && !globalThis.confirm("Quitter la demande ? Votre brouillon non envoyé ne sera pas conservé.")) event.preventDefault(); };
  const changed = (): void => { setDirty(true); if (feedback?.kind === "error") setFeedback(undefined); };
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (inFlight.current || paging.current || load.kind !== "ready" || !startsAt || !responsibilityId || feedback?.kind === "success") return;
    const body = { responsibilityId, startsAt, durationMinutes, type, mode }; inFlight.current = true; setBusy(true); setFeedback(undefined);
    try {
      const booking = await admissionsRequest<AdmissionsBooking>(`/leads/${encodeURIComponent(leadId)}/admissions-bookings`, { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: sameAttempt(attempt, body) }) });
      if (!booking.id || !booking.state) throw new Error("booking_response_invalid");
      setFeedback({ kind: "success", text: booking.state === "PENDING" ? "Demande envoyée. Le créneau est réservé en attente de l’acceptation du responsable." : `État relu : ${admissionsStateLabels[booking.state]}.`, booking }); setDirty(false);
      try { const result = await admissionsRequest<AdmissionsBookingsPage>(`/admissions/bookings?${new URLSearchParams({ leadId, limit: "50" })}`); setLoad((current) => current.kind === "ready" ? { ...current, bookings: result.items, hasMore: result.hasMore === true, nextCursor: result.nextCursor } : current); }
      catch { setFeedback({ kind: "success", text: "Demande enregistrée par le serveur, mais la liste n’a pas pu être actualisée. Ouvrez la demande pour relire son état ; ne la soumettez pas une seconde fois.", booking }); }
    } catch (error) { setFeedback({ kind: "error", text: admissionsError(error) }); } finally { inFlight.current = false; setBusy(false); }
  }
  async function more(): Promise<void> {
    if (load.kind !== "ready" || !load.hasMore || !load.nextCursor || paging.current || inFlight.current) return;
    paging.current = true; setPageBusy(true); setPageError(undefined);
    try { const page = await admissionsRequest<AdmissionsBookingsPage>(`/admissions/bookings?${new URLSearchParams({ leadId, limit: "50", cursor: load.nextCursor })}`); setLoad((current) => current.kind === "ready" ? { ...current, bookings: [...new Map([...current.bookings, ...page.items].map((booking) => [booking.id, booking])).values()], hasMore: page.hasMore === true, nextCursor: page.nextCursor } : current); }
    catch (error) { setPageError(admissionsError(error)); } finally { paging.current = false; setPageBusy(false); }
  }
  if (load.kind === "loading") return <main className="lead-appointment-page"><section className="connected-state" aria-busy="true" role="status"><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Chargement du Lead…</span></section></main>;
  if (load.kind === "error") return <main className="lead-appointment-page"><Link className="lead-profile__back" href={`/leads/${encodeURIComponent(leadId)}`}><ArrowLeft size={17} /> Retour à la fiche</Link><section className="ui-state ui-state--error" role="alert"><h1>Planification indisponible</h1><p>{load.message}</p><button type="button" onClick={() => globalThis.location.reload()}>Réessayer</button></section></main>;
  const chosen = load.responsibilities.find((item) => item.id === responsibilityId);
  return <main className="lead-appointment-page admissions-page">
    <Link className="lead-profile__back" href={`/leads/${encodeURIComponent(leadId)}`} onClick={leave}><ArrowLeft size={17} aria-hidden="true" /> Retour à la fiche</Link>
    <header className="lead-appointment-page__header"><div><p className="eyebrow">Relation Ynov · rendez-vous Admissions</p><h1>Planifier avec {`${load.lead.firstName} ${load.lead.lastName}`.trim() || load.lead.leadCode}</h1><p>Choisissez un responsable et l’un de ses créneaux déclarés libres.</p></div><span><CalendarBlank size={20} aria-hidden="true" /> {load.lead.leadCode}</span></header>
    <div className="lead-appointment-layout"><form className="panel lead-appointment-form" onSubmit={(event) => void submit(event)} onChange={changed}>
      <fieldset disabled={busy || feedback?.kind === "success"}><legend>Préparer la demande</legend><div className="lead-appointment-form__grid">
        <label>Responsable d’admission<select name="responsibilityId" value={responsibilityId} onChange={(event) => { setResponsibilityId(event.target.value); setStartsAt(""); }} required><option value="">Choisir un responsable autorisé</option>{load.responsibilities.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.campusLabel ?? admissionsCampusLabel(item.campus, load.context)}</option>)}</select></label>
        <label>Durée<select name="durationMinutes" value={durationMinutes} onChange={(event) => { setDuration(Number(event.target.value)); setStartsAt(""); }} required>{appointmentDurationOptions.map((duration) => <option value={duration} key={duration}>{duration} minutes</option>)}</select></label>
        <label>Type de rendez-vous<select name="type" value={type} onChange={(event) => setType(event.target.value)} required><option value="ENTRETIEN_ADMISSION">Entretien d’admission</option><option value="ENTRETIEN_MOTIVATION">Entretien de motivation</option><option value="VISITE_CAMPUS">Visite du campus</option><option value="TEST_ADMISSION">Test d’admission</option><option value="APPEL_INFORMATION">Appel d’information</option><option value="RENDEZ_VOUS_DIRECTION">Rendez-vous direction</option><option value="RENDEZ_VOUS_LIBRE">Rendez-vous libre</option></select></label>
        <label>Mode<select name="mode" value={mode} onChange={(event) => setMode(event.target.value)} required><option value="SUR_SITE">Sur site</option><option value="TELEPHONE">Téléphone</option><option value="DISTANCIEL_NON_CONNECTE">À distance</option></select></label>
      </div>
      {!load.responsibilities.length ? <p className="admissions-notice" role="status">Aucun responsable d’admission actif n’est désigné pour ce campus. L’administrateur doit préparer cette affectation avant toute réservation.</p> : null}
      <AdmissionsSlotPicker leadId={leadId} responsibilityId={responsibilityId} durationMinutes={durationMinutes} value={startsAt} onChange={(value) => { setStartsAt(value); changed(); }} disabled={busy || feedback?.kind === "success"} />
      </fieldset>
      {feedback ? <section className={`admissions-feedback admissions-feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.kind === "success" ? <CheckCircle size={22} aria-hidden="true" /> : null}<div><strong>{feedback.text}</strong>{feedback.booking ? <Link href={`/appointments/admissions/${encodeURIComponent(feedback.booking.id)}`}>Ouvrir la demande</Link> : null}</div></section> : null}
      <footer><Link className="text-button" href={`/leads/${encodeURIComponent(leadId)}`} onClick={leave}>Fermer sans envoyer</Link><button className="primary-button" type="submit" disabled={busy || pageBusy || !startsAt || !responsibilityId || feedback?.kind === "success"}>{busy ? "Envoi de la demande…" : "Demander ce rendez-vous"}</button></footer>
    </form><aside className="panel lead-appointment-aside"><ShieldCheck size={22} aria-hidden="true" /><h2>Une demande, puis une décision</h2><dl><div><dt>Responsable</dt><dd>{chosen?.label ?? "À choisir"}</dd></div><div><dt>Campus du Lead</dt><dd>{admissionsCampusLabel(load.lead.campus, load.context)}</dd></div><div><dt>Créneau choisi · Casablanca</dt><dd>{startsAt ? admissionsDate(startsAt) : "À choisir"}</dd></div></dl><p>Le responsable accepte ou refuse séparément. Les occupations et motifs privés ne sont pas exposés. Aucun calendrier externe, email, SMS ou appel automatique n’est déclenché.</p></aside></div>
    {load.bookings.length ? <section className="panel admissions-existing"><h2>Demandes de ce Lead</h2><ul>{load.bookings.map((booking) => <li key={booking.id}><div><strong>{admissionsDate(booking.startsAt)}</strong><span>{booking.responsibleLabel} · {admissionsStateLabels[booking.state]}</span></div><Link className="secondary-button" href={`/appointments/admissions/${encodeURIComponent(booking.id)}`} onClick={leave}>Ouvrir</Link></li>)}</ul></section> : null}
    {load.hasMore ? <div className="admissions-actions"><p>D’autres demandes de ce Lead restent à charger.</p><button className="secondary-button" type="button" onClick={() => void more()} disabled={pageBusy || busy || !load.nextCursor}>{pageBusy ? "Chargement…" : "Charger d’autres demandes de ce Lead"}</button></div> : null}{pageError ? <p className="admissions-error" role="alert">{pageError}</p> : null}
  </main>;
}
