"use client";

import Link from "next/link";
import React, { useEffect, useId, useRef, useState } from "react";

export interface InteractionBody {
  type: string;
  result: string;
  note?: string;
  nextActionAt?: string;
}

export interface StatusBody { status: string; reason: string }
export interface FollowUpBody { dueAt: string; reason: string }
export interface ClosureBody { target: string; reason: string; comment: string; evidence: string[] }
export interface AssignmentCandidate { id: string; label: string; activeLeadCount: number; capacity: number }
export interface FollowUpRecord { id: string; leadId: string; dueAt: string; state: "SCHEDULED" | "DUE" | "COMPLETED" | "CANCELLED"; reason: string; version: number }

type Feedback = { kind: "idle" } | { kind: "preview" | "success" | "error"; message: string };
type CommonProps = {
  leadId: string;
  onCancel?: () => void;
  onCompleted?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function localDateTimeIso(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
}

export function interactionBody(form: FormData): InteractionBody {
  const type = formText(form, "type");
  const result = formText(form, "result");
  const note = formText(form, "note");
  const nextActionAt = localDateTimeIso(formText(form, "nextActionAt"));
  return { type, result, ...(note ? { note } : {}), ...(nextActionAt ? { nextActionAt } : {}) };
}

export function statusBody(form: FormData): StatusBody {
  return { status: formText(form, "status"), reason: formText(form, "reason") };
}

export function followUpBody(form: FormData): FollowUpBody {
  return { dueAt: localDateTimeIso(formText(form, "dueAt")), reason: formText(form, "reason") };
}

export function closureBody(form: FormData): ClosureBody {
  return { target: formText(form, "target"), reason: formText(form, "reason"), comment: formText(form, "comment"), evidence: formText(form, "evidence").split(/\r?\n/u).map((value) => value.trim()).filter(Boolean) };
}

type Operation = "assignment" | "interaction" | "status" | "follow-up";
const operationLabels: Readonly<Record<Operation, string>> = {
  assignment: "L’affectation",
  interaction: "L’interaction",
  status: "Le changement de statut",
  "follow-up": "La relance",
};
const operationFailureMessages: Readonly<Partial<Record<Operation, Readonly<Record<string, string>>>>> = {
  interaction: {
    next_action_invalid: "La date de prochaine action est invalide.",
    next_action_chronology_invalid: "La prochaine action doit être postérieure à l’interaction enregistrée maintenant.",
  },
  status: {
    lead_status_transition_forbidden: "Cette étape n’est pas disponible depuis l’étape actuelle. Utilisez le parcours de clôture pour « Inscrit » ou « Sans suite ».",
    lead_closure_approval_required: "Les étapes « Inscrit » et « Sans suite » nécessitent une demande de clôture validée.",
    lead_closure_reason_required: "Un motif de clôture conforme est obligatoire.",
  },
  "follow-up": {
    follow_up_pending: "Une relance active existe déjà pour ce Lead. Modifiez-la ou clôturez-la avant d’en créer une autre.",
    follow_up_invalid: "La relance nécessite une date future, un motif et un conseiller responsable.",
    follow_up_due_invalid: "Choisissez une nouvelle échéance située dans le futur.",
    follow_up_concurrent: "Cette relance a changé depuis son affichage. Actualisez-la avant de réessayer.",
  },
};
const httpFailureMessages: Readonly<Record<number, string>> = {
  401: "Votre session a expiré. Aucune modification n’a été enregistrée. Reconnectez-vous avant de réessayer ; votre saisie reste affichée.",
  403: "Vous n’avez pas l’autorisation d’effectuer cette action.",
  409: "La situation du Lead a changé. Actualisez la fiche avant de réessayer.",
  422: "Les informations saisies ne respectent pas les règles métier de cette action.",
  429: "Trop de demandes ont été envoyées. Réessayez dans quelques instants.",
};

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const payload = value as Record<string, unknown>;
  if (typeof payload.code === "string") return payload.code;
  return errorCode(payload.message);
}

export function statusTransitionOptions(currentStatus: string): ReadonlyArray<{ value: string; label: string }> {
  if (currentStatus === "PROSPECT") return [{ value: "CONTACTED", label: "Contacté" }];
  if (currentStatus === "CONTACTED") return [{ value: "QUALIFIED", label: "Qualifié" }];
  return [];
}

const statusJourney = [
  { value: "PROSPECT", label: "Prospect" },
  { value: "CONTACTED", label: "Contacté" },
  { value: "QUALIFIED", label: "Qualifié" },
] as const;

export function statusJourneyState(currentStatus: string, value: string): "completed" | "current" | "upcoming" {
  const currentIndex = statusJourney.findIndex((item) => item.value === currentStatus);
  const valueIndex = statusJourney.findIndex((item) => item.value === value);
  if (currentIndex < 0 || valueIndex > currentIndex) return "upcoming";
  return valueIndex === currentIndex ? "current" : "completed";
}

export function nextActionChronologyError(nextActionAt: string, now = new Date()): string | undefined {
  if (!nextActionAt) return undefined;
  const candidate = new Date(nextActionAt);
  if (Number.isNaN(candidate.valueOf())) return "La date de prochaine action est invalide.";
  if (candidate.valueOf() <= now.valueOf()) return "La prochaine action doit être postérieure à l’interaction enregistrée maintenant.";
  return undefined;
}

export function failureMessage(operation: Operation, status: number, code?: string): string {
  const specificMessage = code ? operationFailureMessages[operation]?.[code] : undefined;
  return specificMessage ?? httpFailureMessages[status]
    ?? `${operationLabels[operation]} n’a pas pu être confirmé. Votre saisie est conservée.`;
}

async function responseMessage(operation: Operation, response: Response): Promise<string> {
  let code: string | undefined;
  try { code = errorCode(await response.clone().json()); } catch { /* Réponse non JSON : conserver le message HTTP sûr. */ }
  return failureMessage(operation, response.status, code);
}

function useDirty(onDirtyChange?: (dirty: boolean) => void): { dirty: boolean; markDirty: () => void; clearDirty: () => void } {
  const [dirty, setDirty] = useState(false);
  function update(value: boolean): void { setDirty(value); onDirtyChange?.(value); }
  return { dirty, markDirty: () => update(true), clearDirty: () => update(false) };
}

function FormFeedback({ feedback }: Readonly<{ feedback: Feedback }>): React.JSX.Element | null {
  if (feedback.kind === "idle") return null;
  return <p className={`lead-assignment-dialog__feedback lead-assignment-dialog__feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>;
}

function FormFooter({ busy, submitDisabled = false, submitLabel, onCancel, secondary }: Readonly<{ busy: boolean; submitDisabled?: boolean; submitLabel: string; onCancel?: () => void; secondary?: React.ReactNode }>): React.JSX.Element {
  return <footer className="lead-assignment-dialog__footer">
    {onCancel ? <button className="text-button" type="button" onClick={onCancel} disabled={busy}>Annuler</button> : null}
    {secondary}
    <button className="primary-button" type="submit" disabled={busy || submitDisabled}>{busy ? "Enregistrement…" : submitLabel}</button>
  </footer>;
}

export function AssignmentWorkflowForm({ leadId, assigned, onCancel, onCompleted, onDirtyChange }: Readonly<CommonProps & { assigned: boolean }>): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [candidates, setCandidates] = useState<AssignmentCandidate[]>([]);
  const [candidateState, setCandidateState] = useState<"loading" | "ready" | "error">("loading");
  const formRef = useRef<HTMLFormElement>(null);
  const candidateHelpId = useId();
  const dirty = useDirty(onDirtyChange);

  useEffect(() => {
    const controller = new AbortController();
    setCandidateState("loading");
    void fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/assignment-candidates`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`candidate_${response.status}`);
        const payload = await response.json() as { candidates?: unknown };
        if (!Array.isArray(payload.candidates)) throw new Error("candidate_payload");
        const values = payload.candidates.filter((item): item is AssignmentCandidate => Boolean(item) && typeof item === "object" && typeof (item as AssignmentCandidate).id === "string" && typeof (item as AssignmentCandidate).label === "string");
        setCandidates(values);
        setCandidateState("ready");
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setCandidateState("error"); });
    return (): void => controller.abort();
  }, [leadId]);

  async function submit(action: "preview" | "confirm"): Promise<void> {
    const formElement = formRef.current;
    if (!formElement || busy || !formElement.reportValidity()) return;
    const form = new FormData(formElement);
    const targetUserId = formText(form, "targetUserId");
    const idempotencyKey = `ui-lead-assignment:${crypto.randomUUID()}`;
    const endpoint = assigned ? `/api/crm/leads/${encodeURIComponent(leadId)}/reassignment-requests` : action === "preview" ? "/api/crm/lead-assignments/preview" : `/api/crm/leads/${encodeURIComponent(leadId)}/assignment`;
    const body = assigned
      ? { targetUserId, reason: formText(form, "reason"), moveOpenTasks: form.get("moveOpenTasks") === "on", idempotencyKey }
      : action === "preview"
        ? { idempotencyKey, strategy: "FIXED", targetUserId, items: [{ leadId, source: "UI_LOCAL", campaign: "UI_LOCAL" }] }
        : { targetUserId, confirmed: true, idempotencyKey };
    setBusy(true); setFeedback({ kind: "idle" });
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setFeedback({ kind: "error", message: await responseMessage("assignment", response) }); return; }
      if (!assigned && action === "preview") { setFeedback({ kind: "preview", message: "Prévisualisation terminée. Le Lead n’a pas été modifié." }); return; }
      dirty.clearDirty();
      setFeedback({ kind: "success", message: assigned ? "Demande de réaffectation envoyée pour validation." : "Affectation confirmée. La fiche va être actualisée." });
      onCompleted?.();
    } catch { setFeedback({ kind: "error", message: "Le service est indisponible. Votre saisie est conservée." }); }
    finally { setBusy(false); }
  }

  return <form ref={formRef} className="lead-assignment-dialog__form" onChange={dirty.markDirty} onSubmit={(event) => { event.preventDefault(); void submit("confirm"); }}>
    <label>Conseiller cible
      <select name="targetUserId" required disabled={busy || candidateState !== "ready" || !candidates.length} defaultValue="" aria-describedby={candidateHelpId}>
        <option value="" disabled>{candidateState === "loading" ? "Chargement des conseillers…" : candidates.length ? "Sélectionner un conseiller" : "Aucun conseiller disponible"}</option>
        {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.activeLeadCount}/{candidate.capacity} Leads actifs</option>)}
      </select>
    </label>
    <p id={candidateHelpId} className="lead-assignment-dialog__help">La liste est limitée aux conseillers actifs, autorisés et disponibles pour le campus et la règle applicables. L’éligibilité sera revérifiée lors de la confirmation.</p>
    {candidateState === "error" ? <p className="lead-assignment-dialog__feedback lead-assignment-dialog__feedback--error" role="alert">Les conseillers éligibles sont indisponibles. Aucun identifiant technique ne peut être saisi en remplacement.</p> : null}
    {assigned ? <>
      <label>Motif de la demande<textarea name="reason" required minLength={4} disabled={busy} rows={4} /></label>
      <label className="lead-assignment-dialog__check"><input name="moveOpenTasks" type="checkbox" disabled={busy} /> Transférer également les tâches ouvertes</label>
      <p className="lead-assignment-dialog__notice">La demande reste soumise à la validation prévue par vos permissions.</p>
    </> : <p className="lead-assignment-dialog__notice">Prévisualisez la décision avant de confirmer l’affectation effective.</p>}
    <FormFeedback feedback={feedback} />
    <FormFooter busy={busy} submitDisabled={candidateState !== "ready" || !candidates.length} submitLabel={assigned ? "Envoyer la demande" : "Confirmer l’affectation"} {...(onCancel ? { onCancel } : {})} {...(!assigned ? { secondary: <button className="secondary-button" type="button" disabled={busy || candidateState !== "ready" || !candidates.length} onClick={() => void submit("preview")}>{busy ? "Traitement…" : "Prévisualiser"}</button> } : {})} />
  </form>;
}

export function InteractionWorkflowForm({ leadId, onCancel, onCompleted, onDirtyChange }: Readonly<CommonProps>): React.JSX.Element {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" }); const dirty = useDirty(onDirtyChange);
  const submissionLock = useRef(false);
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (submissionLock.current) return;
    const body = interactionBody(new FormData(event.currentTarget));
    const chronologyError = nextActionChronologyError(body.nextActionAt ?? "");
    if (chronologyError) { setFeedback({ kind: "error", message: chronologyError }); return; }
    submissionLock.current = true; setBusy(true); setFeedback({ kind: "idle" });
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/timeline`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setFeedback({ kind: "error", message: await responseMessage("interaction", response) }); return; }
      dirty.clearDirty(); setFeedback({ kind: "success", message: "Interaction enregistrée dans l’historique protégé." }); onCompleted?.();
    } catch { setFeedback({ kind: "error", message: "Le service est indisponible. Votre saisie est conservée." }); }
    finally { submissionLock.current = false; setBusy(false); }
  }
  return <form className="lead-assignment-dialog__form" onChange={dirty.markDirty} onSubmit={(event) => void save(event)}>
    <label>Type d’interaction<select name="type" required disabled={busy} defaultValue="CRM_CALL" autoFocus><option value="CRM_CALL">Appel depuis le CRM</option><option value="PHONE_CALL">Appel téléphonique</option><option value="PHYSICAL_VISIT">Visite du campus</option><option value="WHATSAPP">Échange WhatsApp</option><option value="MANUAL_EMAIL">Email de suivi</option><option value="MEETING">Rendez-vous</option><option value="COMMENT">Note de suivi</option></select></label>
    <label>Résultat<select name="result" required disabled={busy} defaultValue="NO_ANSWER"><option value="CONNECTED">Contact établi</option><option value="NO_ANSWER">Injoignable</option><option value="COMPLETED">Action terminée</option><option value="FOLLOW_UP_REQUIRED">Relance nécessaire</option><option value="INFORMATION_RECORDED">Information enregistrée</option></select></label>
    <label>Note de suivi<textarea name="note" disabled={busy} rows={5} maxLength={1000} placeholder="Ajoutez uniquement les informations utiles au suivi." /></label>
    <label>Prochaine action<input name="nextActionAt" type="datetime-local" disabled={busy} aria-describedby="interaction-date-help" /></label>
    <p id="interaction-date-help" className="lead-assignment-dialog__help">La saisie suit l’heure locale Africa/Casablanca. Elle doit être postérieure à l’interaction ; le serveur enregistre les instants en UTC.</p>
    <p className="lead-assignment-dialog__notice">Le résultat de contact reste distinct de l’étape commerciale. L’interaction est horodatée par le serveur et l’historique existant n’est jamais réécrit.</p>
    <FormFeedback feedback={feedback} /><FormFooter busy={busy} submitLabel="Enregistrer l’interaction" {...(onCancel ? { onCancel } : {})} />
  </form>;
}

export function StatusWorkflowForm({ leadId, currentStatus, onCancel, onCompleted, onDirtyChange }: Readonly<CommonProps & { currentStatus: string }>): React.JSX.Element {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" }); const dirty = useDirty(onDirtyChange);
  const options = statusTransitionOptions(currentStatus);
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (busy) return; setBusy(true); setFeedback({ kind: "idle" });
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/status`, { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(statusBody(new FormData(event.currentTarget))) });
      if (!response.ok) { setFeedback({ kind: "error", message: await responseMessage("status", response) }); return; }
      dirty.clearDirty(); setFeedback({ kind: "success", message: "Statut mis à jour. La fiche va être actualisée." }); onCompleted?.();
    } catch { setFeedback({ kind: "error", message: "Le service est indisponible. Votre saisie est conservée." }); }
    finally { setBusy(false); }
  }
  return <form className="lead-assignment-dialog__form" onChange={dirty.markDirty} onSubmit={(event) => void save(event)}>
    <section className="lead-status-dialog__journey" aria-labelledby="lead-status-journey-title">
      <h3 id="lead-status-journey-title">Parcours commercial</h3>
      <ol>{statusJourney.map((item) => <li key={item.value} data-state={statusJourneyState(currentStatus, item.value)} aria-current={item.value === currentStatus ? "step" : undefined}>{item.label}</li>)}</ol>
      <p>Étapes de clôture distinctes : « Inscrit » après qualification, ou « Sans suite » après contact. Elles exigent un motif et les droits de validation prévus.</p>
    </section>
    {options.length ? <>
      <label>Étape suivante autorisée<select name="status" required disabled={busy} defaultValue={options[0]?.value} autoFocus>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Motif<textarea name="reason" disabled={busy} rows={5} maxLength={1000} placeholder="Précisez le contexte utile à l’historique." /></label>
      <p className="lead-assignment-dialog__notice">La liste propose uniquement la progression autorisée depuis l’étape actuelle. La température commerciale reste indépendante.</p>
      {(currentStatus === "CONTACTED" || currentStatus === "QUALIFIED") ? <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(leadId)}/closure`}>Ouvrir le parcours « Inscrit / Sans suite »</Link> : null}
      <FormFeedback feedback={feedback} /><FormFooter busy={busy} submitLabel="Enregistrer l’étape" {...(onCancel ? { onCancel } : {})} />
    </> : <div className="lead-status-dialog__terminal" role="status">
      <p>Aucune transition directe n’est disponible depuis cette étape.</p>
      <p>Pour passer à « Inscrit » ou « Sans suite », créez une demande de clôture qui conservera les validations métier et l’historique.</p>
      <Link className="primary-button" href={`/leads/${encodeURIComponent(leadId)}/closure`}>Ouvrir la demande de clôture</Link>
      {onCancel ? <button className="text-button" type="button" onClick={onCancel}>Annuler</button> : null}
    </div>}
  </form>;
}

export function FollowUpWorkflowForm({ leadId, onCancel, onCompleted, onDirtyChange }: Readonly<CommonProps>): React.JSX.Element {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" }); const dirty = useDirty(onDirtyChange);
  const submissionLock = useRef(false); const attempt = useRef<{ payload: string; key: string } | undefined>(undefined);
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (submissionLock.current) return;
    const body = followUpBody(new FormData(event.currentTarget));
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    submissionLock.current = true; setBusy(true); setFeedback({ kind: "idle" });
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/follow-ups`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key }) });
      if (!response.ok) { setFeedback({ kind: "error", message: await responseMessage("follow-up", response) }); return; }
      dirty.clearDirty(); setFeedback({ kind: "success", message: "Relance planifiée. La fiche va être actualisée." }); onCompleted?.();
    } catch { setFeedback({ kind: "error", message: "Le service est indisponible. Votre saisie est conservée." }); }
    finally { submissionLock.current = false; setBusy(false); }
  }
  return <form className="lead-assignment-dialog__form" onChange={dirty.markDirty} onSubmit={(event) => void save(event)}>
    <label>Date et heure<input name="dueAt" type="datetime-local" required disabled={busy} autoFocus /></label>
    <label>Motif<textarea name="reason" required minLength={3} maxLength={1000} disabled={busy} rows={5} placeholder="Indiquez l’objectif de la prochaine prise de contact." /></label>
    <p className="lead-assignment-dialog__notice">La relance prépare une notification interne unique à l’échéance et ajoute une trace d’audit, sans réécrire l’historique existant.</p>
    <FormFeedback feedback={feedback} /><FormFooter busy={busy} submitLabel="Planifier la relance" {...(onCancel ? { onCancel } : {})} />
  </form>;
}

function parseFollowUps(value: unknown, leadId: string): FollowUpRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is FollowUpRecord => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Partial<FollowUpRecord>;
    return row.leadId === leadId && typeof row.id === "string" && typeof row.dueAt === "string" && typeof row.reason === "string" && typeof row.version === "number" && ["SCHEDULED", "DUE", "COMPLETED", "CANCELLED"].includes(row.state ?? "");
  });
}

function followUpStateLabel(state: FollowUpRecord["state"]): string {
  return { SCHEDULED: "Planifiée", DUE: "À traiter", COMPLETED: "Clôturée", CANCELLED: "Annulée" }[state];
}

export function FollowUpHistory({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [items, setItems] = useState<FollowUpRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busyId, setBusyId] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const attempts = useRef(new Map<string, { payload: string; key: string }>());
  const decisionLocks = useRef(new Set<string>());

  async function load(): Promise<void> {
    setState("loading");
    try {
      const response = await fetch("/api/crm/follow-ups", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`follow_up_${response.status}`);
      setItems(parseFollowUps(await response.json(), leadId));
      setState("ready");
    } catch { setState("error"); }
  }

  useEffect(() => { void load(); }, [leadId]);

  async function decide(event: React.FormEvent<HTMLFormElement>, item: FollowUpRecord): Promise<void> {
    event.preventDefault();
    if (decisionLocks.current.has(item.id)) return;
    const form = new FormData(event.currentTarget);
    const action = formText(form, "action") as "POSTPONE" | "COMPLETE" | "CANCEL";
    const reason = formText(form, "reason");
    const dueAt = localDateTimeIso(formText(form, "dueAt"));
    const body = { action, reason, expectedVersion: item.version, ...(action === "POSTPONE" ? { dueAt } : {}) };
    const payload = JSON.stringify(body);
    const previous = attempts.current.get(item.id);
    const attempt = previous?.payload === payload ? previous : { payload, key: crypto.randomUUID() };
    attempts.current.set(item.id, attempt);
    decisionLocks.current.add(item.id);
    setBusyId(item.id); setFeedback({ kind: "idle" });
    try {
      const response = await fetch(`/api/crm/follow-ups/${encodeURIComponent(item.id)}`, { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: attempt.key }) });
      if (!response.ok) { setFeedback({ kind: "error", message: await responseMessage("follow-up", response) }); return; }
      attempts.current.delete(item.id);
      setFeedback({ kind: "success", message: action === "POSTPONE" ? "Relance modifiée et enregistrée." : action === "COMPLETE" ? "Relance clôturée et ajoutée à l’historique." : "Relance annulée et ajoutée à l’historique." });
      await load();
    } catch { setFeedback({ kind: "error", message: "Le service est indisponible. Votre saisie est conservée." }); }
    finally { decisionLocks.current.delete(item.id); setBusyId(undefined); }
  }

  if (state === "loading") return <p role="status">Chargement des relances…</p>;
  if (state === "error") return <div className="lead-follow-up-history__state" role="alert"><p>Les relances sont indisponibles.</p><button className="secondary-button" type="button" onClick={() => void load()}>Réessayer</button></div>;
  return <div className="lead-follow-up-history">
    <FormFeedback feedback={feedback} />
    {!items.length ? <p>Aucune relance enregistrée pour ce Lead.</p> : <ol>{items.map((item) => {
      const active = item.state === "SCHEDULED" || item.state === "DUE";
      return <li key={item.id}>
        <div><span className={`lead-follow-up-history__state lead-follow-up-history__state--${item.state.toLowerCase()}`}>{followUpStateLabel(item.state)}</span><time dateTime={item.dueAt}>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.dueAt))}</time><p>{item.reason}</p></div>
        {active ? <form onSubmit={(event) => void decide(event, item)}>
          <label>Action<select name="action" defaultValue="POSTPONE" disabled={busyId === item.id}><option value="POSTPONE">Modifier l’échéance</option><option value="COMPLETE">Clôturer la relance</option><option value="CANCEL">Annuler la relance</option></select></label>
          <label>Nouvelle échéance<input name="dueAt" type="datetime-local" disabled={busyId === item.id} /></label>
          <label>Motif<textarea name="reason" required minLength={3} maxLength={1000} rows={3} disabled={busyId === item.id} defaultValue={item.reason} /></label>
          <button className="secondary-button" type="submit" disabled={busyId === item.id}>{busyId === item.id ? "Enregistrement…" : "Enregistrer l’action"}</button>
        </form> : null}
      </li>;
    })}</ol>}
    <p className="lead-assignment-dialog__notice">L’enregistrement de la relance est distinct du déclenchement d’une notification à son échéance.</p>
  </div>;
}

export function ClosureWorkflowForm({ leadId, onCancel, onCompleted, onDirtyChange }: Readonly<CommonProps>): React.JSX.Element {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" }); const [target, setTarget] = useState("CLOSED_LOST"); const dirty = useDirty(onDirtyChange);
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (busy) return; setBusy(true); setFeedback({ kind: "idle" });
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/closure-requests`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(closureBody(new FormData(event.currentTarget))) });
      if (!response.ok) { setFeedback({ kind: "error", message: await responseMessage("status", response) }); return; }
      dirty.clearDirty(); setFeedback({ kind: "success", message: "Demande envoyée au Manager. Le statut du Lead reste inchangé jusqu’à la décision." }); onCompleted?.();
    } catch { setFeedback({ kind: "error", message: "Le service est indisponible. Votre saisie est conservée." }); }
    finally { setBusy(false); }
  }
  return <form className="lead-assignment-dialog__form" onChange={dirty.markDirty} onSubmit={(event) => void save(event)}>
    <label>Clôture demandée<select name="target" required disabled={busy} value={target} onChange={(event) => setTarget(event.target.value)} autoFocus><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label>
    <label>Motif normalisé<select key={target} name="reason" required disabled={busy} defaultValue={target === "ENROLLED" ? "ADMISSION_CONFIRMED" : "NOT_INTERESTED"}>{target === "ENROLLED" ? <><option value="ADMISSION_CONFIRMED">Admission confirmée</option><option value="REGISTRATION_COMPLETE">Inscription complète</option></> : <><option value="NOT_INTERESTED">Non intéressé</option><option value="UNREACHABLE">Injoignable après le parcours prévu</option><option value="OTHER_PROGRAM">Autre programme choisi</option></>}</select></label>
    <label>Commentaire<textarea name="comment" required maxLength={1000} disabled={busy} rows={4} placeholder="Expliquez la demande sans données superflues." /></label>
    <label>Preuves métier<textarea name="evidence" required disabled={busy} rows={3} placeholder="Une référence par ligne, sans joindre de document sensible." /></label>
    <p className="lead-assignment-dialog__notice">La demande n’applique pas elle-même la clôture. La séparation des rôles et les validations serveur restent obligatoires.</p>
    <FormFeedback feedback={feedback} /><FormFooter busy={busy} submitLabel="Soumettre au Manager" {...(onCancel ? { onCancel } : {})} />
  </form>;
}
