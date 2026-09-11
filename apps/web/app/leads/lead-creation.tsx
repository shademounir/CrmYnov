"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle, Plus, UserPlus, X } from "@phosphor-icons/react";
import { LeadReferenceSelectors } from "../_components/reference-controls";
import { mutationBody } from "../_components/api-mutation-form";

const requiredFields = ["firstName", "lastName", "educationLevel", "source", "campus", "program", "campaign"] as const;
type FormState = "idle" | "submitting" | "success" | "error";

function Field({ name, label, type = "text", required = false }: Readonly<{ name: string; label: string; type?: string; required?: boolean }>): React.JSX.Element {
  const [error, setError] = useState("");
  return <label className="lead-create-field" htmlFor={`create-${name}`}><span>{label}{required ? <span aria-hidden="true"> *</span> : <span className="lead-create-optional"> Facultatif</span>}</span><input id={`create-${name}`} name={name} type={type} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `create-${name}-error` : undefined} onInvalid={(event) => setError(event.currentTarget.validity.valueMissing ? "Ce champ est obligatoire." : "Vérifiez le format de ce champ.")} onChange={() => setError("")} autoComplete={name === "firstName" ? "given-name" : name === "lastName" ? "family-name" : name === "email" ? "email" : name === "phone" ? "tel" : "off"} />{error ? <span id={`create-${name}-error`} className="lead-create-field-error">{error}</span> : null}</label>;
}

function failureMessage(status: number): string {
  if (status === 401) return "Votre session a expiré. Reconnectez-vous avant de réessayer. Votre saisie est conservée.";
  if (status === 403) return "Vous ne disposez pas des droits pour créer ce lead dans ce campus.";
  if (status === 409) return "Un lead correspondant existe peut-être déjà. Vérifiez la liste avant de réessayer.";
  if (status === 400 || status === 422) return "Certaines informations ne sont pas valides. Vérifiez les champs et les choix de formation.";
  return "La création n’a pas pu être confirmée. Votre saisie est conservée ; vous pouvez réessayer.";
}

export function LeadCreationForm({ onCancel, onDirtyChange }: Readonly<{ onCancel: () => void; onDirtyChange: (dirty: boolean) => void }>): React.JSX.Element {
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current || state === "success") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const missing = requiredFields.find((name) => { const value = data.get(name); return typeof value !== "string" || !value.trim(); });
    if (missing) {
      const field = form.elements.namedItem(missing);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) { field.setCustomValidity("Renseignez ce champ obligatoire."); field.reportValidity(); }
      setState("error"); setError("Complétez les champs obligatoires. Les choix de campus, formation et campagne doivent être disponibles."); return;
    }
    inFlight.current = true; setState("submitting"); setError("");
    try {
      const response = await fetch("/api/crm/leads", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(mutationBody(data, [])) });
      if (!response.ok) { setState("error"); setError(failureMessage(response.status)); return; }
      setState("success"); onDirtyChange(false);
    } catch { setState("error"); setError("La connexion a été interrompue. Aucune création n’a été confirmée ; votre saisie est conservée."); }
    finally { inFlight.current = false; }
  }
  function changed(event: React.FormEvent<HTMLFormElement>): void {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.setCustomValidity("");
    onDirtyChange(true); if (state !== "submitting") { setState("idle"); setError(""); }
  }
  return <form className="lead-create-form" ref={formRef} onSubmit={(event) => { void submit(event); }} onChange={changed} aria-busy={state === "submitting"}>
    <div className="lead-create-body"><p className="lead-create-note">Les champs marqués d’un astérisque sont obligatoires. Les éventuels doublons sont vérifiés lors de la création.</p>
      <fieldset disabled={state === "submitting" || state === "success"} className="lead-create-section"><legend><span className="lead-create-step">01</span> Identité et coordonnées</legend><p>Les informations utiles pour votre premier contact.</p><div className="lead-create-grid"><Field name="firstName" label="Prénom" required /><Field name="lastName" label="Nom" required /><Field name="email" label="Email" type="email" /><Field name="phone" label="Téléphone" type="tel" /></div><p className="lead-create-hint">Renseignez au moins un moyen de contact pour faciliter le suivi.</p></fieldset>
      <fieldset disabled={state === "submitting" || state === "success"} className="lead-create-section"><legend><span className="lead-create-step">02</span> Projet et origine</legend><LeadReferenceSelectors legend="Campus, formation et campagne *" /><div className="lead-create-grid"><Field name="educationLevel" label="Niveau d’études" required /><Field name="source" label="Source du lead" required /></div></fieldset>
      {state === "error" ? <p className="lead-create-error" role="alert">{error}</p> : null}
      {state === "success" ? <div className="lead-create-success" role="status"><CheckCircle size={22} aria-hidden="true" /><div><strong>Le lead a bien été créé.</strong><p>Vous pouvez le retrouver dans votre liste de leads.</p></div></div> : null}
    </div><footer className="lead-create-footer"><span>{state === "submitting" ? "Création en cours…" : "Vos informations restent disponibles en cas d’erreur."}</span><div><button type="button" className="secondary-button" disabled={state === "submitting"} onClick={onCancel}>{state === "success" ? "Revenir aux leads" : "Annuler"}</button>{state !== "success" ? <button type="submit" className="primary-button" disabled={state === "submitting"}><Plus size={18} aria-hidden="true" />{state === "submitting" ? "Création…" : "Créer le lead"}</button> : null}</div></footer>
  </form>;
}

function useDirtyGuard(): { dirty: boolean; setDirty: (value: boolean) => void; canClose: () => boolean } {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent); return (): void => { window.removeEventListener("beforeunload", prevent); };
  }, [dirty]);
  return { dirty, setDirty, canClose: (): boolean => !dirty || window.confirm("Quitter sans créer le lead ? Votre saisie sera perdue.") };
}

export function LeadCreationDrawer(): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { setDirty, canClose } = useDirtyGuard();
  useEffect(() => {
    if (!open || !dialog.current) return;
    dialog.current.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return (): void => { document.body.style.overflow = previous; };
  }, [open]);
  function close(): void { if (dialog.current?.querySelector('form[aria-busy="true"]') || !canClose()) return; dialog.current?.close(); setOpen(false); setDirty(false); trigger.current?.focus(); }
  return <><button type="button" className="primary-button lead-create-trigger" ref={trigger} onClick={() => setOpen(true)}><Plus size={19} weight="bold" aria-hidden="true" /> Nouveau lead</button>{open ? <dialog className="lead-create-dialog" ref={dialog} aria-labelledby="lead-create-title" onCancel={(event) => { event.preventDefault(); close(); }}><header className="lead-create-heading"><div className="lead-create-title-icon"><UserPlus size={25} aria-hidden="true" /></div><div><p className="eyebrow">Base prospects</p><h2 id="lead-create-title">Créer un lead</h2><p>Commencez une nouvelle relation.</p></div><button type="button" className="lead-create-close" aria-label="Fermer la création de lead" onClick={close}><X size={22} aria-hidden="true" /></button></header><LeadCreationForm onCancel={close} onDirtyChange={setDirty} /></dialog> : null}</>;
}

export function LeadCreationPage(): React.JSX.Element {
  const { setDirty, canClose } = useDirtyGuard();
  function back(): void { if (canClose()) window.location.assign("/leads"); }
  return <div className="lead-create-direct"><button className="lead-create-back" type="button" onClick={back}><ArrowLeft size={18} aria-hidden="true" /> Retour aux leads</button><header className="lead-create-heading"><div className="lead-create-title-icon"><UserPlus size={25} aria-hidden="true" /></div><div><p className="eyebrow">Base prospects</p><h1>Créer un lead</h1><p>Commencez une nouvelle relation.</p></div></header><LeadCreationForm onCancel={back} onDirtyChange={setDirty} /></div>;
}
