"use client";
import { useEffect, useId, useRef, useState } from "react";
import { admissionsError, admissionsRequest, sameAttempt, type AdmissionsBooking } from "./admissions-client";
import { AdmissionsSlotPicker } from "./slot-picker";

type BookingAction = "ACCEPT" | "REFUSE" | "CANCEL" | "RESCHEDULE" | "COMPLETE" | "NO_SHOW";
const labels: Readonly<Record<BookingAction, string>> = { ACCEPT: "Accepter le rendez-vous", REFUSE: "Refuser la demande", CANCEL: "Annuler le rendez-vous", RESCHEDULE: "Proposer un autre créneau", COMPLETE: "Marquer comme réalisé", NO_SHOW: "Marquer comme non honoré" };
const reasonRequired = new Set<BookingAction>(["REFUSE", "CANCEL", "RESCHEDULE", "NO_SHOW"]);
const confirmations: Readonly<Record<BookingAction, string>> = { RESCHEDULE: "Nouveau créneau réservé. Une nouvelle acceptation distincte reste nécessaire.", ACCEPT: "Rendez-vous accepté par le responsable.", REFUSE: "Demande refusée ; le créneau est libéré.", CANCEL: "Rendez-vous annulé ; le créneau est libéré.", COMPLETE: "Rendez-vous réalisé, résultat enregistré dans l’historique.", NO_SHOW: "Absence enregistrée dans l’historique du rendez-vous." };
export function admissionsAllowedActions(booking: AdmissionsBooking): BookingAction[] {
  return [...(booking.canDecide ? ["ACCEPT", "REFUSE"] as const : []), ...(booking.canReschedule ? ["RESCHEDULE"] as const : []), ...(booking.canCancel ? ["CANCEL"] as const : []), ...(booking.canComplete ? ["COMPLETE"] as const : []), ...(booking.canNoShow ? ["NO_SHOW"] as const : [])];
}
export function AdmissionsBookingActions({ booking, onUpdated }: Readonly<{ booking: AdmissionsBooking; onUpdated: () => Promise<void> }>): React.JSX.Element {
  const [action, setAction] = useState<BookingAction>(); const [reason, setReason] = useState(""); const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string }>();
  const [awaitingRead, setAwaitingRead] = useState(false);
  const attempt = useRef<{ key: string; payload: string } | undefined>(undefined); const pending = useRef(false); const opener = useRef<HTMLButtonElement | null>(null); const firstField = useRef<HTMLTextAreaElement | null>(null); const confirmation = useRef<HTMLButtonElement | null>(null); const titleId = useId();
  useEffect(() => { if (action) (firstField.current ?? confirmation.current)?.focus(); }, [action]);
  useEffect(() => { setAwaitingRead(false); }, [booking.id, booking.version]);
  const discardAllowed = (): boolean => !(reason.trim() || startsAt) || globalThis.confirm("Fermer cette préparation ? Le motif et le créneau non confirmés ne seront pas envoyés.");
  const close = (): void => { if (busy || !discardAllowed()) return; setAction(undefined); queueMicrotask(() => opener.current?.focus()); };
  const choose = (next: BookingAction, button: HTMLButtonElement): void => { if (action && !discardAllowed()) return; opener.current = button; setAction(next); setReason(""); setStartsAt(""); setFeedback(undefined); attempt.current = undefined; };
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!action || pending.current || awaitingRead || (reasonRequired.has(action) && !reason.trim()) || (action === "RESCHEDULE" && !startsAt)) return;
    const body = { action, expectedVersion: booking.version, ...(reasonRequired.has(action) ? { reason: reason.trim() } : {}), ...(action === "RESCHEDULE" ? { startsAt } : {}) };
    pending.current = true; setBusy(true); setFeedback(undefined);
    try {
      const result = await admissionsRequest<AdmissionsBooking>(`/admissions/bookings/${encodeURIComponent(booking.id)}`, { method: "PATCH", body: JSON.stringify({ ...body, idempotencyKey: sameAttempt(attempt, body) }) });
      if (!result.id || !result.state) throw new Error("booking_response_invalid");
      setAwaitingRead(true); setFeedback({ kind: "success", text: confirmations[action] });
      setAction(undefined); setReason(""); setStartsAt("");
      try { await onUpdated(); } catch { setFeedback({ kind: "success", text: `${confirmations[action]} La relecture est indisponible. Actualisez la demande avant toute autre action ; ne confirmez pas une seconde fois.` }); }
    } catch (error) { setFeedback({ kind: "error", text: admissionsError(error) }); }
    finally { pending.current = false; setBusy(false); }
  }
  const available = admissionsAllowedActions(booking);
  return <section className="admissions-booking-actions" aria-labelledby={titleId}>
    <h3 id={titleId}>Décision et suivi</h3>
    {booking.state === "PENDING" && !booking.canDecide ? <p className="admissions-notice">L’acceptation revient au responsable désigné, distinct du demandeur. La demande seule ne confirme pas le rendez-vous.</p> : null}
    {available.length ? <div className="admissions-actions" role="group" aria-label="Actions autorisées sur cette demande">{available.map((next) => <button key={next} type="button" className={next === "ACCEPT" ? "primary-button" : "secondary-button"} aria-pressed={action === next} disabled={busy || awaitingRead} onClick={(event) => choose(next, event.currentTarget)}>{labels[next]}</button>)}</div> : <p>Aucune nouvelle décision n’est disponible dans votre périmètre pour cet état.</p>}
    {action ? <form className="admissions-action-form" onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <h4>{labels[action]}</h4>
      {reasonRequired.has(action) ? <label>Motif obligatoire<textarea name="reason" ref={firstField} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={120} required disabled={busy} /></label> : <p>{action === "ACCEPT" ? "Accepter confirme ce créneau en conservant la demande initiale et l’identité du décideur." : "Confirmez le résultat réel du rendez-vous. Cette action ajoute une trace, sans effacer la demande."}</p>}
      {action === "RESCHEDULE" ? <><p>L’ancien créneau reste réservé si le report échoue. Choisissez une nouvelle disponibilité déclarée.</p><AdmissionsSlotPicker leadId={booking.leadId} responsibilityId={booking.responsibilityId} bookingId={booking.id} durationMinutes={booking.durationMinutes} value={startsAt} onChange={setStartsAt} disabled={busy} /></> : null}
      <div className="admissions-actions"><button type="button" className="text-button" onClick={close} disabled={busy}>Revenir sans modifier</button><button ref={confirmation} type="submit" className="primary-button" disabled={busy || (reasonRequired.has(action) && !reason.trim()) || (action === "RESCHEDULE" && !startsAt)}>{busy ? "Enregistrement…" : "Confirmer cette action"}</button></div>
    </form> : null}
    {feedback ? <p className={`admissions-feedback admissions-feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p> : null}
  </section>;
}
