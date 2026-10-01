"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { ArrowSquareOut, NotePencil, X } from "@phosphor-icons/react";
import { StatusWorkflowForm, statusBody, type StatusBody } from "./lead-workflow-forms";

export { statusBody, type StatusBody };
export function LeadStatusDrawer({ leadId, leadCode, currentStatus, onCompleted }: Readonly<{ leadId: string; leadCode: string; currentStatus: string; onCompleted?: () => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const [dirty, setDirty] = useState(false);
  function close(): void { if (dirty && !window.confirm("Fermer sans enregistrer vos modifications ?")) return; dialog.current?.close(); setDirty(false); queueMicrotask(() => trigger.current?.focus()); }
  return <><button ref={trigger} className="secondary-button" type="button" onClick={() => { setDirty(false); dialog.current?.showModal(); queueMicrotask(() => dialog.current?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), textarea:not(:disabled)")?.focus()); }}><NotePencil size={18} aria-hidden="true" /> Modifier le statut</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-status-dialog" aria-labelledby="lead-status-title" onCancel={(event) => { if (dirty) { event.preventDefault(); close(); } }}>
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Parcours du prospect</p><h2 id="lead-status-title">Modifier le statut</h2><p>{leadCode} · les contrôles métier restent appliqués par l’API.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau de statut"><X size={20} aria-hidden="true" /></button></header>
      <StatusWorkflowForm leadId={leadId} currentStatus={currentStatus} onCancel={close} onDirtyChange={setDirty} {...(onCompleted ? { onCompleted } : {})} />
      <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(leadId)}/status`}><ArrowSquareOut size={17} aria-hidden="true" /> Ouvrir la gestion détaillée</Link>
    </dialog></>;
}
