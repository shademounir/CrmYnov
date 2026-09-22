"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { ArrowSquareOut, UserSwitch, X } from "@phosphor-icons/react";
import { AssignmentWorkflowForm } from "./lead-workflow-forms";

export function LeadAssignmentDrawer({ leadId, leadCode, assigned, triggerId, onCompleted }: Readonly<{ leadId: string; leadCode: string; assigned: boolean; triggerId?: string; onCompleted?: () => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const [dirty, setDirty] = useState(false);
  const title = assigned ? "Réaffecter ce Lead" : "Affecter ce Lead";
  function close(): void { if (dirty && !window.confirm("Fermer sans enregistrer vos modifications ?")) return; dialog.current?.close(); setDirty(false); queueMicrotask(() => trigger.current?.focus()); }
  return <><button id={triggerId} ref={trigger} className="secondary-button" type="button" onClick={() => { setDirty(false); dialog.current?.showModal(); }}><UserSwitch size={18} aria-hidden="true" /> {assigned ? "Réaffecter" : "Affecter"}</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-assignment-only-dialog" aria-labelledby="lead-assignment-title" onCancel={(event) => { if (dirty) { event.preventDefault(); close(); } }}>
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Équipe du prospect</p><h2 id="lead-assignment-title">{title}</h2><p>{leadCode} · restez dans le contexte de la fiche.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau d’affectation"><X size={20} aria-hidden="true" /></button></header>
      <AssignmentWorkflowForm leadId={leadId} assigned={assigned} onCancel={close} onDirtyChange={setDirty} {...(onCompleted ? { onCompleted } : {})} />
      <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(leadId)}/collaborators`}><ArrowSquareOut size={17} aria-hidden="true" /> Ouvrir la gestion détaillée</Link>
    </dialog></>;
}
