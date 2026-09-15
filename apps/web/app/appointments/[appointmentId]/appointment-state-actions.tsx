"use client";

import { CheckCircle, UserMinus, WarningCircle } from "@phosphor-icons/react";
import { useRef, useState } from "react";

export interface AppointmentStateRecord {
  id: string;
  state: string;
  startsAt: string;
  durationMinutes: number;
  version: number;
}

type TransitionTarget = "CONFIRME" | "REALISE" | "ABSENT" | "ANNULE";

const finalStates = new Set(["ANNULE", "REALISE", "ABSENT", "REFUSE"]);
const reasonRequired = new Set<TransitionTarget>(["ABSENT", "ANNULE"]);

const targetLabels: Readonly<Record<TransitionTarget, string>> = {
  CONFIRME: "Confirmer le rendez-vous",
  REALISE: "Marquer comme réalisé",
  ABSENT: "Marquer comme non honoré",
  ANNULE: "Annuler le rendez-vous",
};

function idempotencyKey(): string {
  const secureId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16).padStart(8, "0")).join("");
  return `appointment-state-${secureId}`;
}

export function appointmentOutcomeAvailable(appointment: Pick<AppointmentStateRecord, "startsAt" | "durationMinutes">, now = Date.now()): boolean {
  return now >= new Date(appointment.startsAt).valueOf() + appointment.durationMinutes * 60_000;
}

function availableTargets(appointment: AppointmentStateRecord): TransitionTarget[] {
  if (finalStates.has(appointment.state)) return [];
  const targets: TransitionTarget[] = [];
  if (["PLANIFIE", "REPORTE"].includes(appointment.state)) targets.push("CONFIRME");
  if (appointment.state === "CONFIRME" && appointmentOutcomeAvailable(appointment)) targets.push("REALISE");
  if (["PLANIFIE", "CONFIRME", "REPORTE"].includes(appointment.state) && appointmentOutcomeAvailable(appointment)) targets.push("ABSENT");
  if (["BROUILLON", "PLANIFIE", "CONFIRME", "REPORTE"].includes(appointment.state)) targets.push("ANNULE");
  return targets;
}

function transitionError(code: string): string {
  if (code === "appointment_outcome_too_early") return "Le résultat ne peut être enregistré qu’après la fin prévue du rendez-vous.";
  if (code === "appointment_reason_required") return "Un motif est obligatoire pour cette décision.";
  if (code === "appointment_transition_refused") return "Le rendez-vous a changé ou cette transition n’est plus permise. Les données ont été actualisées.";
  if (code === "appointment_not_found") return "Ce rendez-vous n’est plus accessible dans votre périmètre.";
  return "Le changement n’a pas pu être confirmé. Votre motif est conservé.";
}

export function AppointmentStateActions({ appointment, onUpdated }: Readonly<{ appointment: AppointmentStateRecord; onUpdated: () => Promise<void> }>): React.JSX.Element {
  const targets = availableTargets(appointment);
  const [target, setTarget] = useState<TransitionTarget | undefined>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const attemptKey = useRef(idempotencyKey());

  if (!targets.length) {
    return <section className="panel appointment-state-panel" aria-labelledby="appointment-state-title">
      <div><p className="eyebrow">Suivi opérationnel</p><h2 id="appointment-state-title">Décision enregistrée</h2></div>
      <p>Ce rendez-vous est dans un état final. Toute correction doit ajouter une trace compensatoire, sans effacer l’historique.</p>
      {message ? <p className={`appointment-state-panel__message appointment-state-panel__message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
    </section>;
  }

  const choose = (next: TransitionTarget): void => {
    setTarget(next);
    setMessage(undefined);
    attemptKey.current = idempotencyKey();
    if (!reasonRequired.has(next)) setReason("");
  };

  const submit = async (): Promise<void> => {
    if (!target || (reasonRequired.has(target) && !reason.trim()) || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/crm/appointments/${encodeURIComponent(appointment.id)}/state`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: target, expectedVersion: appointment.version, idempotencyKey: attemptKey.current, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { code?: string };
        throw new Error(payload.code ?? "appointment_transition_failed");
      }
      setMessage({ kind: "success", text: target === "ABSENT" ? "Absence enregistrée dans l’historique protégé." : "État du rendez-vous enregistré." });
      setTarget(undefined);
      setReason("");
      attemptKey.current = idempotencyKey();
      await onUpdated();
    } catch (error) {
      setMessage({ kind: "error", text: transitionError(error instanceof Error ? error.message : "appointment_transition_failed") });
      await onUpdated().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const outcomePending = ["PLANIFIE", "CONFIRME", "REPORTE"].includes(appointment.state) && !appointmentOutcomeAvailable(appointment);
  return <section className="panel appointment-state-panel" aria-labelledby="appointment-state-title">
    <div className="appointment-state-panel__header"><div><p className="eyebrow">Suivi opérationnel</p><h2 id="appointment-state-title">Tracer l’issue du rendez-vous</h2></div><span>Version {appointment.version}</span></div>
    <p>Chaque changement ajoute un événement, une activité Lead et un audit. Aucun historique n’est réécrit.</p>
    {outcomePending ? <div className="appointment-state-panel__notice"><WarningCircle size={18} aria-hidden="true" /><span>« Réalisé » et « Non honoré » seront proposés uniquement après la fin prévue.</span></div> : null}
    <div className="appointment-state-panel__actions" role="group" aria-label="Actions sur le rendez-vous">
      {targets.map((item) => <button key={item} type="button" className={item === "ABSENT" ? "secondary-button appointment-state-panel__absent" : item === "CONFIRME" || item === "REALISE" ? "primary-button" : "secondary-button"} aria-pressed={target === item} onClick={() => choose(item)} disabled={busy}>
        {item === "ABSENT" ? <UserMinus size={18} aria-hidden="true" /> : <CheckCircle size={18} aria-hidden="true" />}{targetLabels[item]}
      </button>)}
    </div>
    {target ? <div className="appointment-state-panel__confirm">
      <strong>{targetLabels[target]}</strong>
      {reasonRequired.has(target) ? <label>Motif obligatoire<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={busy} placeholder={target === "ABSENT" ? "Ex. Le prospect ne s’est pas présenté au créneau convenu." : "Indiquez la raison de l’annulation."} /></label> : <p>Confirmez cette action. Elle sera historisée avec votre identité et l’heure du serveur.</p>}
      <div><button type="button" className="text-button" onClick={() => setTarget(undefined)} disabled={busy}>Revenir</button><button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || (reasonRequired.has(target) && !reason.trim())}>{busy ? "Enregistrement…" : "Confirmer le changement"}</button></div>
    </div> : null}
    {message ? <p className={`appointment-state-panel__message appointment-state-panel__message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
  </section>;
}
