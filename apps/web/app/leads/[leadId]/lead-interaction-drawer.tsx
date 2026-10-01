"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { ArrowSquareOut, Clock, X } from "@phosphor-icons/react";
import { InteractionWorkflowForm, interactionBody } from "./lead-workflow-forms";

export { interactionBody };
export function LeadInteractionDrawer({ leadId, leadCode, onCompleted }: Readonly<{ leadId: string; leadCode: string; onCompleted?: () => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const [dirty, setDirty] = useState(false);
  function close(): void { if (dirty && !window.confirm("Fermer sans enregistrer vos modifications ?")) return; dialog.current?.close(); setDirty(false); queueMicrotask(() => trigger.current?.focus()); }
  return <><button ref={trigger} className="primary-button" type="button" onClick={() => { setDirty(false); dialog.current?.showModal(); queueMicrotask(() => dialog.current?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), textarea:not(:disabled)")?.focus()); }}><Clock size={18} aria-hidden="true" /> Ajouter une interaction</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-interaction-dialog" aria-labelledby="lead-interaction-title" onCancel={(event) => { if (dirty) { event.preventDefault(); close(); } }}>
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Suivi commercial</p><h2 id="lead-interaction-title">Ajouter une interaction</h2><p>{leadCode} · l’événement sera ajouté à l’historique protégé.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau d’interaction"><X size={20} aria-hidden="true" /></button></header>
      <InteractionWorkflowForm leadId={leadId} onCancel={close} onDirtyChange={setDirty} {...(onCompleted ? { onCompleted } : {})} />
      <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(leadId)}/timeline`}><ArrowSquareOut size={17} aria-hidden="true" /> Ouvrir tout l’historique</Link>
    </dialog></>;
}
