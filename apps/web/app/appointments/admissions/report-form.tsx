"use client";
import { useRef, useState } from "react";
import { admissionsError, admissionsRequest, casablancaDateTimeToIso, sameAttempt, type AdmissionsBooking } from "./admissions-client";

const results: Readonly<Record<string, string>> = { FAVORABLE: "Favorable", FAVORABLE_SOUS_CONDITION: "Favorable sous condition", A_COMPLETER: "À compléter", DEFAVORABLE: "Défavorable", NON_DECIDE: "Non décidé" };
export function AdmissionsReportForm({ booking, onUpdated }: Readonly<{ booking: AdmissionsBooking; onUpdated: () => Promise<void> }>): React.JSX.Element {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<{ error: boolean; text: string }>(); const [saved, setSaved] = useState(false);
  const pending = useRef(false); const attempt = useRef<{ key: string; payload: string } | undefined>(undefined);
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (pending.current || !booking.canWriteReport || saved) return;
    const form = new FormData(event.currentTarget); const text = (name: string): string => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
    const wallTime = text("followUpAt"); const followUpAt = wallTime ? casablancaDateTimeToIso(wallTime) : undefined;
    if (wallTime && (!followUpAt || new Date(followUpAt).valueOf() <= Date.now())) { setFeedback({ error: true, text: "L’échéance de suivi doit être une date future en heure de Casablanca." }); return; }
    const body = { expectedVersion: booking.version, result: text("result"), comment: text("comment"), recommendation: text("recommendation"), ...(text("missingPoints") ? { missingPoints: text("missingPoints") } : {}), ...(text("nextAction") ? { nextAction: text("nextAction") } : {}), ...(followUpAt ? { followUpAt } : {}) };
    if (!body.comment || !body.recommendation || !results[body.result]) return;
    pending.current = true; setBusy(true); setFeedback(undefined);
    try {
      const result = await admissionsRequest<AdmissionsBooking>(`/admissions/bookings/${encodeURIComponent(booking.id)}/report`, { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: sameAttempt(attempt, body) }) });
      if (!result.reportResult) throw new Error("report_response_invalid");
      setSaved(true); setFeedback({ error: false, text: "Compte rendu enregistré. Il ne constitue pas une décision automatique d’admission." });
      try { await onUpdated(); } catch { setFeedback({ error: false, text: "Compte rendu enregistré par le serveur, mais sa relecture est indisponible. Actualisez la demande ; ne l’envoyez pas une seconde fois. Aucun statut d’admission n’a été décidé automatiquement." }); }
    } catch (error) { setFeedback({ error: true, text: admissionsError(error) }); } finally { pending.current = false; setBusy(false); }
  }
  if (booking.reportResult) return <section className="admissions-booking-actions"><h3>Compte rendu enregistré</h3><p>{results[booking.reportResult] ?? "Résultat à vérifier"}. Le compte rendu est conservé ; aucun statut du Lead n’est modifié automatiquement.</p></section>;
  if (!booking.canWriteReport) return <></>;
  return <section className="admissions-booking-actions"><p className="eyebrow">Responsable évaluateur autorisé</p><h3>Consigner le compte rendu</h3><p>Après le rendez-vous réalisé, tracez votre recommandation. Aucun email, relance automatique ou décision d’inscription n’est déclenché.</p>
    <form className="admissions-action-form" onSubmit={(event) => void save(event)}><fieldset disabled={busy || saved}><legend className="sr-only">Compte rendu d’entretien</legend><div className="admissions-fields">
      <label>Résultat de l’entretien<select name="result" defaultValue="NON_DECIDE" required>{Object.entries(results).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Échéance proposée · Casablanca<input type="datetime-local" name="followUpAt" /></label>
      <label>Commentaire obligatoire<textarea name="comment" maxLength={2000} required /></label><label>Recommandation obligatoire<textarea name="recommendation" maxLength={1000} required /></label>
      <label>Éléments à compléter<textarea name="missingPoints" maxLength={2000} /></label><label>Prochaine action proposée<input name="nextAction" maxLength={120} /></label>
    </div></fieldset><div className="admissions-actions"><button type="submit" className="primary-button" disabled={busy || saved}>{busy ? "Enregistrement…" : "Enregistrer le compte rendu"}</button></div></form>
    {feedback ? <p className={`admissions-feedback admissions-feedback--${feedback.error ? "error" : "success"}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
  </section>;
}
