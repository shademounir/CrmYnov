"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowSquareOut, NotePencil, X } from "@phosphor-icons/react";
import { LeadReferenceSelectors } from "../../_components/reference-controls";
import type { LeadProfileRecord } from "./lead-profile";

type EditProps = {
  lead: LeadProfileRecord;
  onCancel?: () => void;
  onCompleted?: (lead: LeadProfileRecord) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function failureMessage(response: Response): Promise<string> {
  let code = "";
  try { const body = await response.json() as { code?: unknown }; code = typeof body.code === "string" ? body.code : ""; } catch { /* response without JSON */ }
  if (response.status === 401) return "Votre session a expiré. Reconnectez-vous avant de réessayer.";
  if (response.status === 403) return "Vous n’avez pas le droit de corriger ce Lead dans ce campus.";
  if (response.status === 409 && code === "lead_contact_collision") return "Ces coordonnées sont déjà utilisées par un autre Lead. Aucune fusion ni modification n’a été réalisée.";
  if (response.status === 409) return "La fiche a été modifiée entre-temps. Actualisez-la avant de réessayer ; votre saisie reste affichée.";
  if (response.status === 400 && code === "lead_email_invalid") return "L’adresse email n’est pas valide.";
  if (response.status === 400 && code === "lead_phone_invalid") return "Le téléphone doit contenir entre 8 et 15 chiffres, avec un + initial facultatif.";
  if (response.status === 400) return "Vérifiez les informations signalées. Aucune modification n’a été enregistrée.";
  return "La correction n’a pas pu être confirmée. Votre saisie est conservée.";
}

export function LeadEditWorkflowForm({ lead, onCancel, onCompleted, onDirtyChange }: Readonly<EditProps>): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "idle" | "success" | "error"; message?: string }>({ kind: "idle" });
  const requestKey = useRef(`ui-lead-edit:${crypto.randomUUID()}`);
  const submissionLock = useRef(false);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || submissionLock.current) return;
    submissionLock.current = true;
    const form = new FormData(event.currentTarget);
    setBusy(true); setFeedback({ kind: "idle" });
    const body = {
      firstName: text(form, "firstName"), lastName: text(form, "lastName"),
      email: text(form, "email"), phone: text(form, "phone"),
      campus: text(form, "campus"), program: text(form, "program"), campaign: text(form, "campaign"),
      educationLevel: text(form, "educationLevel"), source: text(form, "source"),
      expectedVersion: lead.version ?? 1, idempotencyKey: requestKey.current,
    };
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(lead.id)}`, { method: "PATCH", cache: "no-store", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setFeedback({ kind: "error", message: await failureMessage(response) }); return; }
      const updated = await response.json() as LeadProfileRecord;
      requestKey.current = `ui-lead-edit:${crypto.randomUUID()}`;
      onDirtyChange?.(false);
      setFeedback({ kind: "success", message: "Informations corrigées. Les valeurs confirmées par le serveur sont maintenant affichées." });
      onCompleted?.(updated);
    } catch {
      setFeedback({ kind: "error", message: "L’API locale est indisponible. Votre saisie est conservée." });
    } finally { submissionLock.current = false; setBusy(false); }
  }

  return <form className="lead-assignment-dialog__form lead-edit-form" onChange={() => onDirtyChange?.(true)} onSubmit={(event) => void save(event)}>
    <fieldset disabled={busy}><legend>Identité du prospect</legend>
      <div className="lead-edit-form__grid"><label>Prénom<input name="firstName" required maxLength={100} defaultValue={lead.firstName} autoFocus /></label><label>Nom<input name="lastName" required maxLength={100} defaultValue={lead.lastName} /></label></div>
    </fieldset>
    <fieldset disabled={busy}><legend>Coordonnées courantes</legend>
      <div className="lead-edit-form__grid"><label>Email<input name="email" type="email" maxLength={254} defaultValue={lead.email ?? ""} /></label><label>Téléphone<input name="phone" type="tel" maxLength={32} defaultValue={lead.phone ?? ""} /></label></div>
      <p className="lead-assignment-dialog__help">Laisser vide efface explicitement la coordonnée. Le numéro est normalisé sans inventer de chiffre ni de préfixe.</p>
    </fieldset>
    <LeadReferenceSelectors initial={{ campus: lead.campus, program: lead.program, campaign: lead.campaign }} legend="Orientation du prospect" />
    <fieldset disabled={busy}><legend>Contexte d’origine</legend>
      <div className="lead-edit-form__grid"><label>Niveau d’études<input name="educationLevel" required maxLength={80} defaultValue={lead.educationLevel} /></label><label>Source<input name="source" required maxLength={80} defaultValue={lead.source} /></label></div>
      <p className="lead-assignment-dialog__help">La correction met à jour la fiche courante sans réécrire la provenance ni l’historique d’import.</p>
    </fieldset>
    {feedback.kind !== "idle" ? <p className={`lead-assignment-dialog__feedback lead-assignment-dialog__feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p> : null}
    <footer className="lead-assignment-dialog__footer">{onCancel ? <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Annuler</button> : null}<button className="primary-button" type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer les corrections"}</button></footer>
  </form>;
}

export function LeadEditDrawer({ lead, onCompleted }: Readonly<{ lead: LeadProfileRecord; onCompleted?: (lead: LeadProfileRecord) => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const [dirty, setDirty] = useState(false);
  function close(): void { if (dirty && !window.confirm("Fermer sans enregistrer vos modifications ?")) return; dialog.current?.close(); setDirty(false); queueMicrotask(() => trigger.current?.focus()); }
  return <><button ref={trigger} className="secondary-button" type="button" onClick={() => { setDirty(false); dialog.current?.showModal(); queueMicrotask(() => dialog.current?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)")?.focus()); }}><NotePencil size={18} aria-hidden="true" /> Modifier les informations</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-edit-dialog" aria-labelledby="lead-edit-title" onCancel={(event) => { if (dirty) { event.preventDefault(); close(); } }}>
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Dossier du prospect</p><h2 id="lead-edit-title">Corriger les informations</h2><p>{lead.leadCode} · identité et relations conservées.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau de correction"><X size={20} aria-hidden="true" /></button></header>
      <LeadEditWorkflowForm lead={lead} onCancel={close} onDirtyChange={setDirty} onCompleted={(updated) => { setDirty(false); onCompleted?.(updated); }} />
      <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(lead.id)}/edit`}><ArrowSquareOut size={17} aria-hidden="true" /> Ouvrir la page détaillée</Link>
    </dialog></>;
}

export function LeadEditPage({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [state, setState] = useState<{ kind: "loading" | "error" | "ready"; lead?: LeadProfileRecord }>({ kind: "loading" });
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error("lead_unavailable"); setState({ kind: "ready", lead: await response.json() as LeadProfileRecord }); }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setState({ kind: "error" }); }); return (): void => controller.abort(); }, [leadId]);
  return <main className="lead-workflow-page"><Link className="lead-profile__back" href={`/leads/${encodeURIComponent(leadId)}`}><ArrowLeft size={17} aria-hidden="true" /> Retour à la fiche</Link><header className="lead-workflow-page__header"><span><NotePencil size={22} aria-hidden="true" /></span><div><p className="eyebrow">Dossier du prospect</p><h1>Corriger les informations</h1><p>Une page complète utilisant le même contrat que le panneau contextuel.</p></div></header>{state.kind === "loading" ? <section className="panel" aria-busy="true">Chargement de la fiche…</section> : null}{state.kind === "error" ? <section className="ui-state ui-state--error" role="alert">La fiche est indisponible. Aucune donnée fictive ne remplace la réponse de l’API.</section> : null}{state.kind === "ready" && state.lead ? <section className="panel lead-workflow-page__form-card"><LeadEditWorkflowForm lead={state.lead} onCompleted={(lead): void => setState({ kind: "ready", lead })} /></section> : null}</main>;
}
