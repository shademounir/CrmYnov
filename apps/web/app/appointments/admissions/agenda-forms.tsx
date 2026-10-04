"use client";
import { useRef, useState } from "react";
import { admissionsCampusLabel, admissionsDate, admissionsError, admissionsRequest, casablancaDateTimeToIso, sameAttempt, type AdmissionsContext, type AdmissionsResponsibility, type AdmissionsWindow } from "./admissions-client";

export function AdmissionsWindowForm({ responsibilities, onUpdated }: Readonly<{ responsibilities: AdmissionsResponsibility[]; onUpdated: () => Promise<void> }>): React.JSX.Element {
  const [responsibilityId, setResponsibilityId] = useState(responsibilities.length === 1 ? responsibilities[0]!.id : ""); const [kind, setKind] = useState<"AVAILABLE" | "BLOCKED">("AVAILABLE"); const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const pending = useRef(false); const attempt = useRef<{ key: string; payload: string } | undefined>(undefined);
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (pending.current || !responsibilities.some((item) => item.id === responsibilityId && item.active)) return;
    const startsAt = casablancaDateTimeToIso(start); const endsAt = casablancaDateTimeToIso(end);
    if (!startsAt || !endsAt || new Date(startsAt).valueOf() <= Date.now() || startsAt >= endsAt) { setFeedback({ error: true, text: "Choisissez une plage future, avec une fin après le début, en heure de Casablanca." }); return; }
    const body = { responsibilityId, kind, startsAt, endsAt }; pending.current = true; setBusy(true); setFeedback(undefined);
    try { const window = await admissionsRequest<AdmissionsWindow>("/admissions/windows", { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: sameAttempt(attempt, body) }) }); if (!window.id) throw new Error("window_response_invalid"); try { await onUpdated(); setFeedback({ error: false, text: kind === "AVAILABLE" ? "Disponibilité enregistrée et relue depuis le serveur." : "Indisponibilité privée enregistrée et relue depuis le serveur." }); setStart(""); setEnd(""); attempt.current = undefined; } catch { setFeedback({ error: false, text: "Plage enregistrée par le serveur, mais sa relecture est indisponible. Actualisez l’agenda. Votre saisie et la clé de cette tentative sont conservées." }); } }
    catch (error) { setFeedback({ error: true, text: admissionsError(error) }); } finally { pending.current = false; setBusy(false); }
  }
  if (!responsibilities.length) return <section className="panel admissions-panel"><h2>Mes disponibilités</h2><p>Aucun profil responsable actif ne vous est attribué. Les créneaux ne sont jamais déduits d’un rôle Commercial ou Manager.</p></section>;
  return <section className="panel admissions-panel"><p className="eyebrow">Mon agenda · Casablanca</p><h2>Déclarer une plage</h2><p>Une disponibilité ouvre des créneaux. Une indisponibilité ferme une plage, sans exposer votre engagement aux commerciaux.</p><form onSubmit={(event) => void save(event)}>
    <fieldset disabled={busy}><legend className="sr-only">Plage manuelle de l’agenda</legend><div className="admissions-fields">
      <label>Responsable et campus<select name="windowResponsibilityId" value={responsibilityId} onChange={(event) => setResponsibilityId(event.target.value)} required><option value="">Choisir mon profil</option>{responsibilities.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.label} · {item.campusLabel ?? "Campus autorisé"}</option>)}</select></label>
      <label>Nature de la plage<select name="windowKind" value={kind} onChange={(event) => setKind(event.target.value as "AVAILABLE" | "BLOCKED")}><option value="AVAILABLE">Disponible pour les rendez-vous</option><option value="BLOCKED">Indisponible · engagement privé</option></select></label>
      <label>Début · Casablanca<input name="windowStart" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>Fin · Casablanca<input name="windowEnd" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
    </div></fieldset><div className="admissions-actions"><button type="submit" className="primary-button" disabled={busy || !responsibilityId || !start || !end}>{busy ? "Enregistrement…" : "Enregistrer la plage"}</button></div>
    {feedback ? <p className={`admissions-feedback admissions-feedback--${feedback.error ? "error" : "success"}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
  </form></section>;
}

export function AdmissionsWindows({ items, context, onUpdated }: Readonly<{ items: AdmissionsWindow[]; context: Pick<AdmissionsContext, "campuses">; onUpdated: () => Promise<void> }>): React.JSX.Element {
  const [busyId, setBusyId] = useState<string>(); const [message, setMessage] = useState<string>(); const pending = useRef(false); const attempts = useRef(new Map<string, string>());
  async function retire(window: AdmissionsWindow): Promise<void> {
    if (pending.current || !globalThis.confirm("Retirer cette plage ? Les réservations existantes ne seront ni effacées ni annulées.")) return;
    pending.current = true; setBusyId(window.id); setMessage(undefined);
    const key = attempts.current.get(`${window.id}:${window.version}`) ?? crypto.randomUUID(); attempts.current.set(`${window.id}:${window.version}`, key);
    try { await admissionsRequest(`/admissions/windows/${encodeURIComponent(window.id)}`, { method: "PATCH", body: JSON.stringify({ active: false, expectedVersion: window.version, idempotencyKey: key }) }); try { await onUpdated(); } catch { setMessage("Retrait confirmé par le serveur, mais la liste n’a pas pu être relue. Actualisez l’agenda avant de vous fier aux plages affichées."); } }
    catch (error) { setMessage(admissionsError(error)); } finally { pending.current = false; setBusyId(undefined); }
  }
  const active = items.filter((item) => item.active);
  return <section className="panel admissions-panel"><h2>Plages déclarées</h2><p>Ces disponibilités et indisponibilités restent limitées à votre périmètre d’agenda.</p>{active.length ? <ul className="admissions-window-list">{active.map((item) => <li key={item.id} data-kind={item.kind}><div><strong>{item.kind === "AVAILABLE" ? "Disponible" : "Indisponible · privé"}</strong><span>{admissionsDate(item.startsAt)} → {admissionsDate(item.endsAt)}</span><small>{admissionsCampusLabel(item.campus, context)}</small></div><button type="button" className="text-button" onClick={() => void retire(item)} disabled={!!busyId}>{busyId === item.id ? "Retrait…" : "Retirer cette plage"}</button></li>)}</ul> : <p className="admissions-notice">Aucune plage active. Déclarez vos disponibilités avant de recevoir de nouvelles demandes.</p>}{message ? <p className="admissions-error" role="alert">{message}</p> : null}</section>;
}

export function AdmissionsResponsibilities({ context, items, onUpdated }: Readonly<{ context: AdmissionsContext; items: AdmissionsResponsibility[]; onUpdated: () => Promise<void> }>): React.JSX.Element {
  const [campus, setCampus] = useState(""); const [userId, setUserId] = useState(""); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<{ error: boolean; text: string }>(); const pending = useRef(false); const attempt = useRef<{ key: string; payload: string } | undefined>(undefined);
  const candidates = context.eligibleUsers.filter((user) => user.campus === campus);
  async function save(body: { userId: string; campus: string; active: boolean; expectedVersion: number }): Promise<void> {
    if (pending.current) return; pending.current = true; setBusy(true); setFeedback(undefined);
    try { await admissionsRequest("/admissions/responsibles", { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: sameAttempt(attempt, body) }) }); try { await onUpdated(); setFeedback({ error: false, text: body.active ? "Responsable désigné et relu dans le périmètre autorisé." : "Désignation désactivée. Aucun droit global n’a été ajouté." }); if (body.active) setUserId(""); } catch { setFeedback({ error: false, text: "Désignation enregistrée par le serveur, mais sa relecture est indisponible. Actualisez l’agenda ; aucun droit global n’a été ajouté. La clé de cette tentative est conservée." }); } }
    catch (error) { setFeedback({ error: true, text: admissionsError(error) }); } finally { pending.current = false; setBusy(false); }
  }
  if (!context.canManageResponsibilities) return <></>;
  return <section className="panel admissions-panel"><p className="eyebrow">Administration bornée</p><h2>Désigner un responsable d’admission</h2><p>Seuls les utilisateurs activés du campus autorisé sont proposés. Cette désignation ne confère pas de rôle Manager ni d’accès supplémentaire aux Leads.</p>
    <form onSubmit={(event) => { event.preventDefault(); const existing = items.find((item) => item.userId === userId && item.campus === campus); void save({ userId, campus, active: true, expectedVersion: existing?.version ?? 0 }); }}><fieldset disabled={busy}><legend className="sr-only">Désignation du responsable</legend><div className="admissions-fields">
      <label>Campus autorisé<select name="responsibilityCampus" value={campus} onChange={(event) => { setCampus(event.target.value); setUserId(""); }} required><option value="">Choisir un campus</option>{context.campuses.map((item) => <option key={item.id} value={item.code}>{item.label}</option>)}</select></label>
      <label>Utilisateur activé<select name="responsibilityUserId" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={!campus || busy} required><option value="">Choisir un utilisateur du campus</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div></fieldset>{campus && !candidates.length ? <p role="status" className="admissions-notice">Aucun utilisateur activé éligible pour ce campus.</p> : null}<div className="admissions-actions"><button type="submit" className="primary-button" disabled={busy || !userId || !campus}>{busy ? "Enregistrement…" : "Désigner ce responsable"}</button></div></form>
    {feedback ? <p className={`admissions-feedback admissions-feedback--${feedback.error ? "error" : "success"}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
    {items.length ? <ul className="admissions-window-list">{items.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span>{item.campusLabel ?? admissionsCampusLabel(item.campus, context)} · {item.active ? "Actif" : "Désactivé"}</span></div>{item.active ? <button className="text-button" type="button" disabled={busy} onClick={() => { if (globalThis.confirm("Désactiver ce profil ? Les réservations restent conservées et la révocation s’applique aux prochaines actions.")) void save({ userId: item.userId, campus: item.campus, active: false, expectedVersion: item.version }); }}>Désactiver</button> : null}</li>)}</ul> : null}
  </section>;
}
