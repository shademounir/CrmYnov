"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { ThermometerSimple, X } from "@phosphor-icons/react";

type Temperature = "UNEVALUATED" | "COLD" | "WARM" | "HOT";
type Qualification = {
  temperature: Temperature;
  temperatureLabel: string;
  reason?: string;
  comment?: string;
  authorId?: string;
  version: number;
  createdAt?: string;
};
type LoadState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; current: Qualification; history: Qualification[] }
  | { kind: "error"; message: string };

const choices: ReadonlyArray<{ value: Exclude<Temperature, "UNEVALUATED">; label: string; description: string }> = [
  { value: "COLD", label: "Froid", description: "Faible intérêt déclaré ou projet sans échéance exploitable, avec motif." },
  { value: "WARM", label: "Tiède", description: "Intérêt déclaré, mais projet, échéance ou prochaine étape encore à préciser." },
  { value: "HOT", label: "Chaud", description: "Intérêt explicite, projet ou rentrée identifié et prochaine étape convenue et datée." },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseQualification(value: unknown): Qualification | undefined {
  if (!isRecord(value) || typeof value.temperature !== "string" || typeof value.version !== "number") return undefined;
  if (!["UNEVALUATED", "COLD", "WARM", "HOT"].includes(value.temperature)) return undefined;
  const result: Qualification = {
    temperature: value.temperature as Temperature,
    temperatureLabel: typeof value.temperatureLabel === "string" ? value.temperatureLabel : "Non évalué",
    version: value.version,
  };
  if (typeof value.reason === "string") result.reason = value.reason;
  if (typeof value.comment === "string") result.comment = value.comment;
  if (typeof value.authorId === "string") result.authorId = value.authorId;
  if (typeof value.createdAt === "string") result.createdAt = value.createdAt;
  return result;
}

function messageFor(status: number): string {
  if (status === 403) return "Votre rôle ne permet pas de qualifier ce Lead. Demandez à un administrateur de vérifier vos droits.";
  if (status === 409) return "La qualification a changé depuis l’ouverture. Actualisez les données avant de recommencer.";
  if (status === 400) return "Vérifiez la température et le motif. Votre saisie est conservée.";
  return "La qualification n’a pas pu être enregistrée. Votre saisie est conservée.";
}

function formatDate(value: string | undefined): string {
  if (!value) return "Date indisponible";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(date);
}

export function LeadQualificationDrawer({ leadId, leadCode, temperatureLabel, onCompleted }: Readonly<{ leadId: string; leadCode: string; temperatureLabel: string; onCompleted?: () => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const submissionLocked = useRef(false);
  const initialFocusDone = useRef(false);
  const descriptionId = useId();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: "idle" | "success" | "error"; message?: string }>({ kind: "idle" });

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    setFeedback({ kind: "idle" });
    void fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/qualification`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`qualification_${response.status}`);
        const payload: unknown = await response.json();
        if (!isRecord(payload) || !Array.isArray(payload.history)) throw new Error("qualification_payload");
        const current = parseQualification(payload.current);
        const history = payload.history.flatMap((item) => { const parsed = parseQualification(item); return parsed ? [parsed] : []; });
        if (!current) throw new Error("qualification_payload");
        setState({ kind: "ready", current, history });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error", message: "La qualification actuelle est indisponible. Aucun changement n’est possible tant que la version serveur n’est pas connue." });
      });
    return (): void => controller.abort();
  }, [leadId, opened, reloadVersion]);

  useEffect(() => {
    if (!opened || state.kind !== "ready" || initialFocusDone.current) return;
    initialFocusDone.current = true;
    const focusChoice = (): void => form.current?.querySelector<HTMLInputElement>('input[name="temperature"]:checked, input[name="temperature"]')?.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusChoice);
    else queueMicrotask(focusChoice);
  }, [opened, state]);

  function close(): void {
    if (dirty && !window.confirm("Fermer sans enregistrer vos modifications ?")) return;
    dialog.current?.close();
    setOpened(false);
    setDirty(false);
    queueMicrotask(() => trigger.current?.focus());
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submissionLocked.current || state.kind !== "ready") return;
    const values = new FormData(event.currentTarget);
    const temperature = values.get("temperature");
    const reason = values.get("reason");
    const comment = values.get("comment");
    if (typeof temperature !== "string" || typeof reason !== "string" || typeof comment !== "string") return;
    submissionLocked.current = true;
    setBusy(true);
    setFeedback({ kind: "idle" });
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/qualification`, {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ temperature, reason: reason.trim(), ...(comment.trim() ? { comment: comment.trim() } : {}), expectedVersion: state.current.version, idempotencyKey: `ui-lead-qualification:${crypto.randomUUID()}` }),
      });
      if (!response.ok) { setFeedback({ kind: "error", message: messageFor(response.status) }); return; }
      const saved = parseQualification(await response.json());
      if (!saved) { setFeedback({ kind: "error", message: "La réponse du serveur est incomplète. Actualisez la fiche avant toute nouvelle saisie." }); return; }
      setState((current) => current.kind === "ready" ? { kind: "ready", current: saved, history: [saved, ...current.history] } : current);
      setDirty(false);
      setFeedback({ kind: "success", message: `Température enregistrée : ${saved.temperatureLabel}.` });
      onCompleted?.();
    } catch {
      setFeedback({ kind: "error", message: "Le service est indisponible. Votre saisie est conservée." });
    } finally {
      submissionLocked.current = false;
      setBusy(false);
    }
  }

  return <>
    <button ref={trigger} className="secondary-button" type="button" onClick={() => { setDirty(false); initialFocusDone.current = false; setOpened(true); dialog.current?.showModal(); }}><ThermometerSimple size={18} aria-hidden="true" /> Qualifier</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-qualification-dialog" aria-labelledby="lead-qualification-title" aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Qualification commerciale</p><h2 id="lead-qualification-title">Température du Lead</h2><p id={descriptionId}>{leadCode} · actuellement {temperatureLabel.toLowerCase()}.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau de qualification"><X size={20} aria-hidden="true" /></button></header>
      {state.kind === "loading" || state.kind === "idle" ? <div className="lead-qualification-dialog__state" role="status" aria-busy="true">Chargement de la qualification…</div> : null}
      {state.kind === "error" ? <div className="lead-qualification-dialog__state lead-assignment-dialog__feedback--error" role="alert">{state.message}<button className="secondary-button" type="button" onClick={() => setReloadVersion((version) => version + 1)}>Réessayer</button></div> : null}
      {state.kind === "ready" ? <form key={state.current.version} ref={form} className="lead-assignment-dialog__form" onChange={() => { setDirty(true); setFeedback({ kind: "idle" }); }} onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy}><legend>Qualification manuelle</legend><div className="lead-qualification-dialog__choices">
          {choices.map((choice) => <label key={choice.value}><input type="radio" name="temperature" value={choice.value} required defaultChecked={state.current.temperature === choice.value} /><span><strong>{choice.label}</strong><small>{choice.description}</small></span></label>)}
        </div></fieldset>
        <p className="lead-assignment-dialog__notice">« Non évalué » signifie qu’aucune qualification humaine valable n’a encore été enregistrée. Une absence de réponse ne suffit pas à classer un Lead froid.</p>
        <label>Motif de la qualification<textarea name="reason" required minLength={3} maxLength={240} rows={3} disabled={busy} placeholder="Décrivez le signal commercial observé." /></label>
        <label>Commentaire facultatif<textarea name="comment" maxLength={1000} rows={3} disabled={busy} placeholder="Ajoutez uniquement le contexte utile au suivi." /></label>
        {feedback.kind !== "idle" ? <p className={`lead-assignment-dialog__feedback lead-assignment-dialog__feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p> : null}
        <details className="lead-qualification-dialog__history"><summary>Historique des qualifications ({state.history.length})</summary>{state.history.length ? <ol>{state.history.map((item) => <li key={`${item.version}-${item.createdAt}`}><strong>v{item.version} · {item.temperatureLabel}</strong><span>{formatDate(item.createdAt)}</span><p>{item.reason}</p></li>)}</ol> : <p>Aucune qualification humaine enregistrée.</p>}</details>
        <footer className="lead-assignment-dialog__footer"><button className="text-button" type="button" onClick={close} disabled={busy}>Annuler</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer la température"}</button></footer>
      </form> : null}
    </dialog>
  </>;
}
