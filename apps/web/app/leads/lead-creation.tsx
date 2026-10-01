"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle, Info, Plus, UserPlus, Warning, X } from "@phosphor-icons/react";
import { LeadReferenceSelectors } from "../_components/reference-controls";
import { mutationBody } from "../_components/api-mutation-form";

const requiredFields = ["firstName", "lastName", "educationLevel", "source", "campus", "program", "campaign"] as const;
type FormState = "idle" | "submitting" | "success" | "error";
interface CreatedLead { id: string; leadCode: string }
interface CreationResponse { lead?: CreatedLead; duplicateCandidates?: string[]; code?: string }

function Field({ name, label, type = "text", required = false, help, placeholder, inputMode }: Readonly<{
  name: string; label: string; type?: string; required?: boolean; help?: string; placeholder?: string;
  inputMode?: "email" | "tel" | "text";
}>): React.JSX.Element {
  const [error, setError] = useState("");
  const helpId = help ? `create-${name}-help` : undefined;
  const errorId = error ? `create-${name}-error` : undefined;
  return <label className="lead-create-field" htmlFor={`create-${name}`}>
    <span>{label}{required ? <span aria-hidden="true"> *</span> : <span className="lead-create-optional"> Facultatif</span>}</span>
    <input id={`create-${name}`} name={name} type={type} required={required} placeholder={placeholder} inputMode={inputMode}
      maxLength={type === "email" ? 254 : type === "tel" ? 24 : 120} aria-invalid={Boolean(error)}
      aria-describedby={[helpId, errorId].filter(Boolean).join(" ") || undefined}
      onInvalid={(event) => setError(event.currentTarget.validity.valueMissing ? "Ce champ est obligatoire." : "Vérifiez le format de ce champ.")}
      onChange={() => setError("")} autoComplete={name === "firstName" ? "given-name" : name === "lastName" ? "family-name" : name === "email" ? "email" : name === "phone" ? "tel" : "off"} />
    {help ? <small id={helpId} className="lead-create-field-help">{help}</small> : null}
    {error ? <span id={errorId} className="lead-create-field-error">{error}</span> : null}
  </label>;
}

function failureMessage(status: number, code?: string): string {
  if (status === 401) return "Votre session a expiré. Reconnectez-vous avant de réessayer. Votre saisie est conservée.";
  if (status === 403) return "Vous ne disposez pas des droits pour créer ce Lead dans ce campus. Votre saisie est conservée.";
  if (code === "lead_email_invalid") return "L’adresse email n’est pas valide. Corrigez-la avant de réessayer.";
  if (code === "lead_phone_invalid") return "Le téléphone doit contenir entre 8 et 15 chiffres. Les espaces et séparateurs sont acceptés.";
  if (code === "lead_idempotency_conflict") return "Cette demande a déjà été enregistrée avec un contenu différent. Vérifiez la liste avant toute nouvelle tentative.";
  if (status === 409) return "La création est en conflit avec un enregistrement récent. Vérifiez la liste avant de réessayer.";
  if (status === 400 || status === 422) return "Certaines informations ne sont pas valides. Vérifiez les coordonnées et les choix de formation.";
  return "La création n’a pas pu être confirmée. Votre saisie est conservée ; vous pouvez réessayer sans créer un doublon.";
}

async function readCreationResponse(response: Response): Promise<CreationResponse> {
  try { return await response.json() as CreationResponse; } catch { return {}; }
}

export function LeadCreationForm({ onCancel, onDirtyChange }: Readonly<{ onCancel: () => void; onDirtyChange: (dirty: boolean) => void }>): React.JSX.Element {
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedLead | null>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current || state === "success") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const missing = requiredFields.find((name) => { const value = data.get(name); return typeof value !== "string" || !value.trim(); });
    if (missing) {
      const field = form.elements.namedItem(missing);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
        field.setCustomValidity("Renseignez ce champ obligatoire."); field.reportValidity(); field.focus();
      }
      setState("error"); setError("Complétez les champs obligatoires. Les choix de campus, formation et campagne doivent être disponibles."); return;
    }
    const requestKey = idempotencyKey.current ?? `lead-create-${globalThis.crypto.randomUUID()}`;
    idempotencyKey.current = requestKey;
    inFlight.current = true; setState("submitting"); setError("");
    try {
      const body = { ...mutationBody(data, []), idempotencyKey: requestKey };
      const response = await fetch("/api/crm/leads", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await readCreationResponse(response);
      if (!response.ok || !result.lead?.id || !result.lead.leadCode) {
        setState("error"); setError(failureMessage(response.status, result.code)); return;
      }
      setCreated(result.lead); setDuplicateCandidates(Array.isArray(result.duplicateCandidates) ? result.duplicateCandidates : []);
      setState("success"); onDirtyChange(false);
    } catch {
      setState("error"); setError("La connexion a été interrompue. Votre saisie et votre identifiant de demande sont conservés : réessayez sans modifier les champs.");
    } finally { inFlight.current = false; }
  }

  function changed(event: React.FormEvent<HTMLFormElement>): void {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.setCustomValidity("");
    onDirtyChange(true); if (state !== "submitting") { setState("idle"); setError(""); }
  }

  return <form className="lead-create-form" ref={formRef} onSubmit={(event) => { void submit(event); }} onChange={changed} aria-busy={state === "submitting"}>
    <div className="lead-create-body">
      <div className="lead-create-note"><Info size={18} aria-hidden="true" /><p><strong>Création contrôlée</strong><span>Les champs * sont obligatoires. Une correspondance de coordonnées est signalée sans fusion automatique.</span></p></div>
      <fieldset disabled={state === "submitting" || state === "success"} className="lead-create-section">
        <legend><span className="lead-create-step">01</span><span>Identité et coordonnées<small>Qui devons-nous contacter ?</small></span></legend>
        <div className="lead-create-grid">
          <Field name="firstName" label="Prénom" required />
          <Field name="lastName" label="Nom" required />
          <Field name="email" label="Email" type="email" inputMode="email" placeholder="prenom.nom@exemple.ma" />
          <Field name="phone" label="Téléphone" type="tel" inputMode="tel" placeholder="+212 6…" help="8 à 15 chiffres ; les espaces sont acceptés." />
        </div>
        <p className="lead-create-hint">Ajoutez au moins un moyen de contact lorsque vous le connaissez. L’API contrôle le format et recherche les correspondances existantes.</p>
      </fieldset>
      <fieldset disabled={state === "submitting" || state === "success"} className="lead-create-section">
        <legend><span className="lead-create-step">02</span><span>Projet et origine<small>Dans quel parcours l’orienter ?</small></span></legend>
        <LeadReferenceSelectors legend="Référentiels autorisés *" />
        <div className="lead-create-grid">
          <Field name="educationLevel" label="Niveau d’études" required placeholder="Ex. BAC" />
          <Field name="source" label="Source du Lead" required placeholder="Ex. Salon étudiant" />
        </div>
      </fieldset>
      {state === "error" ? <p className="lead-create-error" role="alert"><Warning size={20} aria-hidden="true" />{error}</p> : null}
      {state === "success" && created ? <div className="lead-create-success" role="status">
        <CheckCircle size={24} weight="fill" aria-hidden="true" />
        <div><strong>{created.leadCode} a bien été créé.</strong><p>L’écriture est confirmée par l’API. Ouvrez la fiche pour poursuivre le suivi.</p>
          {duplicateCandidates.length ? <p className="lead-create-collision"><Warning size={17} aria-hidden="true" /> {duplicateCandidates.length} correspondance{duplicateCandidates.length > 1 ? "s" : ""} potentielle{duplicateCandidates.length > 1 ? "s" : ""} détectée{duplicateCandidates.length > 1 ? "s" : ""}. Aucun dossier n’a été fusionné.</p> : null}
          <div className="lead-create-success-actions"><Link className="primary-button" href={`/leads/${encodeURIComponent(created.id)}`}>Ouvrir la fiche</Link><a className="secondary-button" href={`/leads?search=${encodeURIComponent(created.leadCode)}`}>Voir dans la liste</a></div>
        </div>
      </div> : null}
    </div>
    <footer className="lead-create-footer"><span>{state === "submitting" ? "Création en cours — ne fermez pas cette fenêtre." : state === "success" ? "Création confirmée et traçable." : "En cas d’erreur, vos informations restent dans le formulaire."}</span><div><button type="button" className="secondary-button" disabled={state === "submitting"} onClick={onCancel}>{state === "success" ? "Fermer" : "Annuler"}</button>{state !== "success" ? <button type="submit" className="primary-button" disabled={state === "submitting"}><Plus size={18} aria-hidden="true" />{state === "submitting" ? "Création…" : "Créer le Lead"}</button> : null}</div></footer>
  </form>;
}

function useDirtyGuard(): { setDirty: (value: boolean) => void; canClose: () => boolean } {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent); return (): void => { window.removeEventListener("beforeunload", prevent); };
  }, [dirty]);
  return { setDirty, canClose: (): boolean => !dirty || window.confirm("Quitter sans créer le Lead ? Votre saisie sera perdue.") };
}

export function LeadCreationDrawer(): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { setDirty, canClose } = useDirtyGuard();
  useEffect(() => {
    if (!open || !dialog.current) return;
    dialog.current.showModal();
    queueMicrotask(() => dialog.current?.querySelector<HTMLInputElement>('input[name="firstName"]')?.focus());
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return (): void => { document.body.style.overflow = previous; };
  }, [open]);
  function close(): void {
    if (dialog.current?.querySelector('form[aria-busy="true"]') || !canClose()) return;
    dialog.current?.close(); setOpen(false); setDirty(false); trigger.current?.focus();
  }
  return <><button type="button" className="primary-button lead-create-trigger" ref={trigger} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Plus size={19} weight="bold" aria-hidden="true" /> Nouveau Lead</button>{open ? <dialog className="lead-create-dialog" ref={dialog} aria-labelledby="lead-create-title" onCancel={(event) => { event.preventDefault(); close(); }}><header className="lead-create-heading"><div className="lead-create-title-icon"><UserPlus size={25} aria-hidden="true" /></div><div><p className="eyebrow">Base prospects</p><h2 id="lead-create-title">Créer un Lead</h2><p>Ajoutez un prospect et qualifiez son parcours dès le premier contact.</p></div><button type="button" className="lead-create-close" aria-label="Fermer la création de Lead" onClick={close}><X size={22} aria-hidden="true" /></button></header><LeadCreationForm onCancel={close} onDirtyChange={setDirty} /></dialog> : null}</>;
}

export function LeadCreationPage(): React.JSX.Element {
  const { setDirty, canClose } = useDirtyGuard();
  function back(): void { if (canClose()) window.location.assign("/leads"); }
  return <div className="lead-create-direct"><button className="lead-create-back" type="button" onClick={back}><ArrowLeft size={18} aria-hidden="true" /> Retour aux Leads</button><header className="lead-create-heading"><div className="lead-create-title-icon"><UserPlus size={25} aria-hidden="true" /></div><div><p className="eyebrow">Base prospects</p><h1>Créer un Lead</h1><p>Ajoutez un prospect et qualifiez son parcours dès le premier contact.</p></div></header><LeadCreationForm onCancel={back} onDirtyChange={setDirty} /></div>;
}
