"use client";

import { ArrowClockwise, ArrowRight, PhoneDisconnect, PhoneIncoming, ShieldCheck, WarningCircle, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Call = Readonly<{ id: string; direction: "INBOUND" | "OUTBOUND"; state: string; leadId?: string; maskedPhone: string; matchState: string; requestedAt: string; durationSeconds?: number }>;
type Queue = Readonly<{ missed: Call[]; toVerify: Call[] }>;
type State = { kind: "loading" } | { kind: "ready"; queue: Queue } | { kind: "session" | "forbidden" | "error"; message: string };
type View = "missed" | "verify";
type Candidate = Readonly<{ id: string; leadCode: string; displayName: string; campus: string }>;

const callStates: Readonly<Record<string, string>> = { REQUESTED: "Demandé", RINGING: "Sonnerie", ANSWERED: "Décroché", MISSED: "Manqué", FAILED: "Échec", CANCELLED: "Annulé", ENDED: "Terminé" };
const matchStates: Readonly<Record<string, string>> = { MATCHED: "Lead retrouvé", CONFIRMED: "Rapprochement confirmé", UNMATCHED: "Aucun Lead retrouvé", AMBIGUOUS: "Plusieurs correspondances" };

export async function loadCallQueue(request: typeof fetch = fetch): Promise<State> {
  const response = await request("/api/crm/telephony/queue", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  if (response.status === 401) return { kind: "session", message: "Votre session a expiré. Reconnectez-vous pour consulter la file d’appels." };
  if (response.status === 403) return { kind: "forbidden", message: "Votre rôle ne permet pas de consulter cette file." };
  if (!response.ok) return { kind: "error", message: "La file d’appels est momentanément indisponible. Aucun appel n’a été modifié." };
  const payload = await response.json() as Partial<Queue>;
  if (!Array.isArray(payload.missed) || !Array.isArray(payload.toVerify)) return { kind: "error", message: "La réponse du serveur est incomplète. Aucun appel n’a été modifié." };
  return { kind: "ready", queue: { missed: payload.missed, toVerify: payload.toVerify } };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(value));
}

export function CallQueue(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [view, setView] = useState<View>("missed");
  const [selected, setSelected] = useState<Call>();
  const refresh = useCallback(async (): Promise<void> => { setState({ kind: "loading" }); setState(await loadCallQueue().catch((): State => ({ kind: "error", message: "La file d’appels est momentanément indisponible. Aucun appel n’a été modifié." }))); }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const items = useMemo(() => state.kind === "ready" ? (view === "missed" ? state.queue.missed : state.queue.toVerify) : [], [state, view]);

  if (state.kind === "loading") return <section className="panel calls-queue calls-queue--loading" aria-busy="true" aria-live="polite"><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="sr-only">Chargement de la file d’appels…</span></section>;
  if (state.kind !== "ready") return <section className="ui-state ui-state--error calls-queue__state" role="alert"><WarningCircle size={28} /><h2>File indisponible</h2><p>{state.message}</p><button type="button" className="secondary-button" onClick={() => void refresh()}><ArrowClockwise size={18} /> Réessayer</button></section>;

  return <section className="panel calls-queue" aria-label="File d’appels">
    <header className="calls-queue__toolbar">
      <div className="calls-queue__tabs" role="tablist" aria-label="Vues d’appels">
        <button type="button" role="tab" aria-selected={view === "missed"} className={view === "missed" ? "is-active" : ""} onClick={() => setView("missed")}><PhoneDisconnect size={18} /> Appels manqués <span>{state.queue.missed.length}</span></button>
        <button type="button" role="tab" aria-selected={view === "verify"} className={view === "verify" ? "is-active" : ""} onClick={() => setView("verify")}><ShieldCheck size={18} /> À vérifier <span>{state.queue.toVerify.length}</span></button>
      </div>
      <button type="button" className="text-button" onClick={() => void refresh()}><ArrowClockwise size={17} /> Actualiser</button>
    </header>
    {items.length === 0 ? <div className="calls-queue__empty" role="status"><PhoneIncoming size={30} /><div><h2>Aucun appel dans cette file</h2><p>Les nouveaux événements internes apparaîtront ici sans créer ni réaffecter automatiquement un Lead.</p></div></div> : <ol className="calls-queue__list">
      {items.map((call) => <li key={call.id}>
        <span className={`calls-queue__call-icon ${call.state === "MISSED" ? "is-alert" : ""}`} aria-hidden="true">{call.state === "MISSED" ? <PhoneDisconnect size={20} /> : <PhoneIncoming size={20} />}</span>
        <div className="calls-queue__identity"><p className="eyebrow">{call.direction === "INBOUND" ? "Appel entrant" : "Appel sortant"}</p><h3>{call.maskedPhone}</h3><time dateTime={call.requestedAt}>{formatDate(call.requestedAt)} · heure de Casablanca</time></div>
        <dl><div><dt>État</dt><dd>{callStates[call.state] ?? "À qualifier"}</dd></div><div><dt>Rapprochement</dt><dd>{matchStates[call.matchState] ?? "À vérifier"}</dd></div></dl>
        <div className="calls-queue__actions">{call.leadId ? <a className="secondary-button" href={`/leads/${call.leadId}/calls?callId=${encodeURIComponent(call.id)}`}>Ouvrir <ArrowRight size={16} /></a> : <button type="button" className="secondary-button" onClick={() => setSelected(call)}>Rapprocher <ArrowRight size={16} /></button>}</div>
      </li>)}
    </ol>}
    {selected ? <AssociationDialog call={selected} onClose={() => setSelected(undefined)} onAssociated={async () => { setSelected(undefined); await refresh(); }} /> : null}
  </section>;
}

function AssociationDialog({ call, onClose, onAssociated }: Readonly<{ call: Call; onClose(): void; onAssociated(): Promise<void> }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; items: Candidate[] } | { kind: "error"; message: string }>({ kind: "loading" });
  const [candidateId, setCandidateId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/crm/calls/${encodeURIComponent(call.id)}/association-candidates`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { items?: Candidate[] };
      if (!Array.isArray(payload.items)) throw new Error("invalid");
      setState({ kind: "ready", items: payload.items }); setCandidateId(payload.items[0]?.id ?? "");
    } catch { setState({ kind: "error", message: "Les correspondances autorisées sont indisponibles. Aucun rapprochement n’a été effectué." }); }
  }, [call.id]);
  useEffect(() => { dialog.current?.showModal(); void load(); }, [load]);
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!candidateId || busy) return; setBusy(true); setFeedback("");
    try {
      const response = await fetch(`/api/crm/calls/${encodeURIComponent(call.id)}/association`, { method: "POST", credentials: "same-origin", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ leadId: candidateId }) });
      if (response.status === 409) { setFeedback("Cette décision a déjà été prise ou la correspondance téléphonique n’est plus valable. Actualisez la file."); return; }
      if (!response.ok) { setFeedback("Le rapprochement n’a pas pu être confirmé. Aucun Lead n’a été modifié."); return; }
      await onAssociated();
    } catch { setFeedback("Le serveur est indisponible. Aucun Lead n’a été modifié."); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="lead-assignment-dialog calls-association-dialog" aria-labelledby="calls-association-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Décision humaine</p><h2 id="calls-association-title">Rapprocher l’appel</h2><p>{call.maskedPhone} · aucune création ni affectation automatique.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Fermer le rapprochement"><X size={20} /></button></header>
    <form className="lead-assignment-dialog__form" onSubmit={(event) => void submit(event)}>
      {state.kind === "loading" ? <p role="status" aria-busy="true">Recherche des Leads autorisés correspondant à l’empreinte téléphonique…</p> : null}
      {state.kind === "error" ? <><p className="lead-assignment-dialog__feedback lead-assignment-dialog__feedback--error" role="alert">{state.message}</p><button type="button" className="secondary-button" onClick={() => void load()}>Réessayer</button></> : null}
      {state.kind === "ready" && state.items.length === 0 ? <section className="lead-assignment-dialog__blocked" role="status"><h3>Aucune correspondance disponible</h3><p>Le CRM ne propose aucun Lead visible portant cette empreinte téléphonique. L’appel reste dans la file « À vérifier ».</p></section> : null}
      {state.kind === "ready" && state.items.length > 0 ? <><label>Lead correspondant<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={busy}>{state.items.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.leadCode} · {candidate.displayName} · {candidate.campus}</option>)}</select></label><p className="lead-assignment-dialog__notice">Le serveur revérifie le périmètre, l’empreinte du téléphone et l’absence de décision concurrente avant d’écrire l’association.</p>{feedback ? <p className="lead-assignment-dialog__feedback lead-assignment-dialog__feedback--error" role="alert">{feedback}</p> : null}<footer className="lead-assignment-dialog__footer"><button type="button" className="text-button" onClick={onClose} disabled={busy}>Annuler</button><button type="submit" className="primary-button" disabled={!candidateId || busy}>{busy ? "Confirmation…" : "Confirmer le rapprochement"}</button></footer></> : null}
    </form>
  </dialog>;
}
