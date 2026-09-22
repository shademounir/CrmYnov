"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { ArrowSquareOut, CalendarBlank, X } from "@phosphor-icons/react";
import { FollowUpWorkflowForm, followUpBody, type FollowUpBody } from "./lead-workflow-forms";

export { followUpBody, type FollowUpBody };
export function LeadFollowUpDrawer({ leadId, leadCode, assigned, assignmentTriggerId, onCompleted }: Readonly<{ leadId: string; leadCode: string; assigned: boolean; assignmentTriggerId: string; onCompleted?: () => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const [dirty, setDirty] = useState(false);
  function close(): void { if (dirty && !window.confirm("Fermer sans enregistrer vos modifications ?")) return; dialog.current?.close(); setDirty(false); queueMicrotask(() => trigger.current?.focus()); }
  function openAssignment(): void { dialog.current?.close(); queueMicrotask(() => document.getElementById(assignmentTriggerId)?.click()); }
  return <><button ref={trigger} className="secondary-button" type="button" aria-describedby={!assigned ? `${assignmentTriggerId}-follow-up-help` : undefined} onClick={() => { setDirty(false); dialog.current?.showModal(); queueMicrotask(() => dialog.current?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), textarea:not(:disabled), button:not(:disabled)")?.focus()); }}><CalendarBlank size={18} aria-hidden="true" /> Planifier une relance</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-follow-up-dialog" aria-labelledby="lead-follow-up-title" onCancel={(event) => { if (dirty) { event.preventDefault(); close(); } }}>
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Prochaine action</p><h2 id="lead-follow-up-title">Planifier une relance</h2><p>{leadCode} · restez dans le contexte de la fiche.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau de relance"><X size={20} aria-hidden="true" /></button></header>
      {assigned ? <><FollowUpWorkflowForm leadId={leadId} onCancel={close} onDirtyChange={setDirty} {...(onCompleted ? { onCompleted } : {})} />
        <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(leadId)}/follow-ups`}><ArrowSquareOut size={17} aria-hidden="true" /> Ouvrir toutes les relances</Link></> : <section className="lead-assignment-dialog__blocked" id={`${assignmentTriggerId}-follow-up-help`} role="status">
        <h3>Affectation nécessaire</h3>
        <p>Une relance doit avoir un conseiller responsable. Affectez d’abord ce Lead ; le formulaire de relance sera ensuite disponible sans quitter la fiche.</p>
        <button className="primary-button" type="button" onClick={openAssignment}>Affecter ce Lead</button>
        <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(leadId)}/follow-ups`}><ArrowSquareOut size={17} aria-hidden="true" /> Consulter les relances existantes</Link>
      </section>}
    </dialog></>;
}
