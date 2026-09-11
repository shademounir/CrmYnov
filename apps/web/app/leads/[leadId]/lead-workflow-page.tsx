"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { ArrowLeft, CalendarBlank, Clock, NotePencil, UserSwitch } from "@phosphor-icons/react";
import { ConnectedResource } from "../../_components/connected-resource";
import { AssignmentWorkflowForm, ClosureWorkflowForm, FollowUpHistory, FollowUpWorkflowForm, InteractionWorkflowForm, StatusWorkflowForm } from "./lead-workflow-forms";

type Surface = "assignment" | "interaction" | "status" | "follow-up" | "closure";
type LeadContext = { leadCode: string; firstName: string; lastName: string; status: string; assignedToId?: string };

const surfaceCopy: Record<Surface, { eyebrow: string; title: string; description: string; icon: React.ReactNode }> = {
  assignment: { eyebrow: "Équipe du prospect", title: "Affectation et réaffectation", description: "Sélectionnez un conseiller autorisé sans quitter le contexte du dossier.", icon: <UserSwitch size={22} aria-hidden="true" /> },
  interaction: { eyebrow: "Suivi commercial", title: "Historique et interactions", description: "Consultez l’historique protégé et ajoutez un nouveau contact sans réécriture.", icon: <Clock size={22} aria-hidden="true" /> },
  status: { eyebrow: "Parcours du prospect", title: "Étape commerciale", description: "Appliquez une transition contrôlée ; le résultat de contact reste une dimension distincte.", icon: <NotePencil size={22} aria-hidden="true" /> },
  "follow-up": { eyebrow: "Prochaine action", title: "Relances du Lead", description: "Planifiez une échéance claire et consultez les relances déjà enregistrées.", icon: <CalendarBlank size={22} aria-hidden="true" /> },
  closure: { eyebrow: "Décision contrôlée", title: "Clôture du Lead", description: "Préparez une demande motivée ; le statut reste inchangé avant validation.", icon: <NotePencil size={22} aria-hidden="true" /> },
};

function parseLeadContext(value: unknown): LeadContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.leadCode !== "string" || typeof row.status !== "string") return undefined;
  return {
    leadCode: row.leadCode,
    firstName: typeof row.firstName === "string" ? row.firstName : "",
    lastName: typeof row.lastName === "string" ? row.lastName : "",
    status: row.status,
    ...(typeof row.assignedToId === "string" && row.assignedToId ? { assignedToId: row.assignedToId } : {}),
  };
}

function ResourceForSurface({ leadId, surface }: Readonly<{ leadId: string; surface: Surface }>): React.JSX.Element | null {
  if (surface === "interaction") return <ConnectedResource endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}/timeline`} ariaLabel="Historique protégé du Lead" emptyMessage="Aucune interaction enregistrée." fields={[{ key: "type", label: "Événement" }, { key: "result", label: "Résultat" }, { key: "occurredAt", label: "Date" }]} />;
  if (surface === "follow-up") return <FollowUpHistory leadId={leadId} />;
  if (surface === "assignment") return <ConnectedResource endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}/reassignment-requests`} ariaLabel="Historique des demandes de réaffectation" emptyMessage="Aucune demande de réaffectation." fields={[{ key: "status", label: "État" }, { key: "reason", label: "Motif" }, { key: "requestedAt", label: "Demandée le" }, { key: "decisionReason", label: "Décision" }]} />;
  if (surface === "closure") return <ConnectedResource endpoint="/api/crm/closure-requests" ariaLabel="Demandes de clôture autorisées" emptyMessage="Aucune demande de clôture." fields={[{ key: "target", label: "Résultat visé" }, { key: "reason", label: "Motif" }, { key: "state", label: "État" }, { key: "createdAt", label: "Demandée le" }]} />;
  return null;
}

function useLeadContext(leadId: string): Readonly<{ context?: LeadContext; state: "loading" | "ready" | "error" }> {
  const [context, setContext] = useState<LeadContext | undefined>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`lead_${response.status}`);
        const parsed = parseLeadContext(await response.json());
        if (!parsed) throw new Error("lead_payload");
        setContext(parsed);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("error");
      });
    return (): void => controller.abort();
  }, [leadId]);
  return { ...(context ? { context } : {}), state };
}

function contextLeadCode(context: LeadContext | undefined, state: "loading" | "ready" | "error"): string {
  if (state === "ready") return context?.leadCode ?? "Contexte indisponible";
  return state === "error" ? "Contexte indisponible" : "Chargement…";
}

function contextDisplayName(context: LeadContext | undefined): string {
  return context ? [context.firstName, context.lastName].filter(Boolean).join(" ") || "Prospect" : "Prospect";
}

function workflowActionTitle(surface: Surface, assigned: boolean): string {
  const titles: Readonly<Record<Exclude<Surface, "assignment">, string>> = {
    interaction: "Nouvelle interaction",
    status: "Modifier l’étape",
    "follow-up": "Nouvelle relance",
    closure: "Nouvelle demande",
  };
  return surface === "assignment" ? assigned ? "Demander une réaffectation" : "Affecter le Lead" : titles[surface];
}

function WorkflowAction({ leadId, surface, context, contextState }: Readonly<{
  leadId: string;
  surface: Surface;
  context?: LeadContext;
  contextState: "loading" | "ready" | "error";
}>): React.JSX.Element | null {
  if (surface === "assignment") return <AssignmentWorkflowForm leadId={leadId} assigned={Boolean(context?.assignedToId)} />;
  if (surface === "interaction") return <InteractionWorkflowForm leadId={leadId} />;
  if (surface === "closure") return <ClosureWorkflowForm leadId={leadId} />;
  if (surface === "status") {
    return context
      ? <StatusWorkflowForm leadId={leadId} currentStatus={context.status} />
      : <p role="status">{contextState === "error" ? "Le statut actuel est indisponible. Aucun changement ne peut être proposé." : "Chargement de l’étape actuelle…"}</p>;
  }
  if (context?.assignedToId) return <FollowUpWorkflowForm leadId={leadId} />;
  if (contextState === "ready") return <p className="lead-assignment-dialog__notice" role="status">Affectez d’abord le Lead à un conseiller. La relance pourra ensuite être enregistrée sous sa responsabilité.</p>;
  return null;
}

function WorkflowHistory({ leadId, surface }: Readonly<{ leadId: string; surface: Surface }>): React.JSX.Element {
  if (surface !== "status") return <ResourceForSurface leadId={leadId} surface={surface} />;
  return <><p>Les changements sont contrôlés par l’API et ajoutés à l’historique. Une clôture reste soumise au parcours dédié.</p><Link className="secondary-button" href={`/leads/${encodeURIComponent(leadId)}/closure`}>Ouvrir les demandes de clôture</Link></>;
}

export function LeadWorkflowPage({ leadId, surface }: Readonly<{ leadId: string; surface: Surface }>): React.JSX.Element {
  const { context, state: contextState } = useLeadContext(leadId);
  const copy = surfaceCopy[surface];
  return <main className="lead-workflow-page">
    <Link className="lead-profile__back" href={`/leads/${encodeURIComponent(leadId)}`}><ArrowLeft size={17} aria-hidden="true" /> Retour à la fiche</Link>
    <header className="lead-workflow-page__header"><span>{copy.icon}</span><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div></header>
    <section className="panel lead-workflow-page__context" aria-live="polite">
      <div><span>Dossier</span><strong>{contextLeadCode(context, contextState)}</strong></div>
      <div><span>Prospect</span><strong>{contextState === "ready" ? contextDisplayName(context) : "—"}</strong></div>
      <div><span>Principe</span><strong>Contrôles serveur conservés</strong></div>
    </section>
    <div className="lead-workflow-page__grid">
      <section className="panel lead-workflow-page__form-card" aria-labelledby="workflow-action-title"><div className="lead-workflow-page__section-heading"><p className="eyebrow">Action</p><h2 id="workflow-action-title">{workflowActionTitle(surface, Boolean(context?.assignedToId))}</h2></div>
        <WorkflowAction leadId={leadId} surface={surface} {...(context ? { context } : {})} contextState={contextState} />
      </section>
      <section className="panel lead-workflow-page__history" aria-labelledby="workflow-history-title"><div className="lead-workflow-page__section-heading"><p className="eyebrow">Traçabilité</p><h2 id="workflow-history-title">{surface === "status" ? "Règles de transition" : "Éléments enregistrés"}</h2></div>
        <WorkflowHistory leadId={leadId} surface={surface} />
      </section>
    </div>
  </main>;
}
