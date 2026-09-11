"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { ArrowSquareOut, CalendarBlank, X } from "@phosphor-icons/react";
import { FollowUpWorkflowForm, followUpBody, type FollowUpBody } from "./lead-workflow-forms";

export { followUpBody, type FollowUpBody };
export function LeadFollowUpDrawer({ leadId, leadCode, assigned, onCompleted }: Readonly<{ leadId: string; leadCode: string; assigned: boolean; onCompleted?: () => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const [dirty, setDirty] = useState(false);
  function close(): void { if (dirty && !window.confirm("Fermer sans enregistrer vos modifications ?")) return; dialog.current?.close(); setDirty(false); queueMicrotask(() => trigger.current?.focus()); }
  return <><button ref={trigger} className="secondary-button" type="button" disabled={!assigned} title={assigned ? undefined : "Affectez d’abord le Lead à un conseiller"} onClick={() => { setDirty(false); dialog.current?.showModal(); queueMicrotask(() => dialog.current?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), textarea:not(:disabled)")?.focus()); }}><CalendarBlank size={18} aria-hidden="true" /> Planifier une relance</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-follow-up-dialog" aria-labelledby="lead-follow-up-title" onCancel={(event) => { if (dirty) { event.preventDefault(); close(); } }}>
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Prochaine action</p><h2 id="lead-follow-up-title">Planifier une relance</h2><p>{leadCode} · restez dans le contexte de la fiche.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau de relance"><X size={20} aria-hidden="true" /></button></header>
      <FollowUpWorkflowForm leadId={leadId} onCancel={close} onDirtyChange={setDirty} {...(onCompleted ? { onCompleted } : {})} />
      <Link className="lead-assignment-dialog__details" href={`/leads/${encodeURIComponent(leadId)}/follow-ups`}><ArrowSquareOut size={17} aria-hidden="true" /> Ouvrir toutes les relances</Link>
    </dialog></>;
}
