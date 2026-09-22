"use client";

import Link from "next/link";
import React from "react";
import {
  ArrowLeft,
  CalendarBlank,
  Clock,
  EnvelopeSimple,
  FileText,
  GraduationCap,
  LinkSimple,
  MapPin,
  Megaphone,
  Phone,
  PhoneCall,
  ThermometerSimple,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { LeadAssignmentDrawer } from "./lead-assignment-drawer";
import { LeadFollowUpDrawer } from "./lead-follow-up-drawer";
import { LeadInteractionDrawer } from "./lead-interaction-drawer";
import { LeadCallDrawer } from "./lead-call-drawer";
import { LeadQualificationDrawer } from "./lead-qualification-drawer";
import { LeadStatusDrawer } from "./lead-status-drawer";
import { LeadEditDrawer } from "./lead-edit-workflow";

export interface LeadProfileRecord {
  id: string;
  leadCode: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  campus: string;
  campaign: string;
  educationLevel: string;
  program: string;
  source: string;
  status: string;
  assignedToId?: string;
  collaboratorIds: string[];
  nextActionAt?: string;
  createdAt?: string;
  temperature: "UNEVALUATED" | "COLD" | "WARM" | "HOT";
  temperatureLabel: string;
  qualificationVersion: number;
  version?: number;
}

export interface LeadTimelineEvent {
  id: string;
  type: string;
  result: string;
  occurredAt: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; lead: LeadProfileRecord; events: LeadTimelineEvent[] }
  | { kind: "session" | "forbidden" | "missing" | "error" };

const statusLabels: Readonly<Record<string, string>> = {
  PROSPECT: "À contacter",
  CONTACTED: "Contacté",
  QUALIFIED: "Qualifié",
  ENROLLED: "Inscrit",
  CLOSED_LOST: "Sans suite",
};

const eventLabels: Readonly<Record<string, string>> = {
  LEAD_CREATED: "Lead créé",
  ASSIGNMENT_CHANGED: "Affectation mise à jour",
  STATUS_CHANGED: "Statut modifié",
  CRM_CALL: "Appel de suivi",
  EXTERNAL_CALL: "Appel externe",
  PHONE_CALL: "Appel téléphonique",
  PHYSICAL_VISIT: "Visite du campus",
  WHATSAPP: "Échange WhatsApp",
  MANUAL_EMAIL: "Email de suivi",
  MEETING: "Rendez-vous",
  COMMENT: "Note de suivi",
  CORRECTION: "Correction tracée",
  TAGS_CHANGED: "Tags mis à jour",
  REASSIGNMENT_REQUESTED: "Réaffectation demandée",
  REASSIGNMENT_REJECTED: "Réaffectation refusée",
  PROVENANCE_ATTACHED: "Provenance ajoutée",
  LEGACY_IMPORT: "Import historique",
};

const sourceLabels: Readonly<Record<string, string>> = {
  WEB_FORM: "Formulaire web",
  WEBSITE: "Site web",
  FORMINATOR_ZAPIER: "Formulaire automatisé",
  YNOV_COM: "Site Ynov",
  PHONE_CALL: "Appel téléphonique",
  PHYSICAL_VISIT: "Visite du campus",
  JOBINTECH: "JobInTech",
  LEGACY_IMPORT: "Import historique",
  MANUAL_ENTRY: "Saisie manuelle",
};

class RequestError extends Error {
  constructor(readonly status: number) {
    super(`request_${status}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseLead(value: unknown): LeadProfileRecord | undefined {
  if (!isObject(value)) return undefined;
  const id = requiredString(value, "id");
  const leadCode = requiredString(value, "leadCode");
  if (!id || !leadCode) return undefined;
  const lead: LeadProfileRecord = {
    id,
    leadCode,
    firstName: requiredString(value, "firstName"),
    lastName: requiredString(value, "lastName"),
    campus: requiredString(value, "campus"),
    campaign: requiredString(value, "campaign"),
    educationLevel: requiredString(value, "educationLevel"),
    program: requiredString(value, "program"),
    source: requiredString(value, "source"),
    status: requiredString(value, "status"),
    collaboratorIds: stringArray(value.collaboratorIds),
    temperature: ["COLD", "WARM", "HOT"].includes(requiredString(value, "temperature")) ? requiredString(value, "temperature") as "COLD" | "WARM" | "HOT" : "UNEVALUATED",
    temperatureLabel: optionalString(value, "temperatureLabel") ?? "Non évalué",
    qualificationVersion: typeof value.qualificationVersion === "number" ? value.qualificationVersion : 0,
    version: typeof value.version === "number" ? value.version : 1,
  };
  const email = optionalString(value, "email");
  const phone = optionalString(value, "phone");
  const assignedToId = optionalString(value, "assignedToId");
  const nextActionAt = optionalString(value, "nextActionAt");
  const createdAt = optionalString(value, "createdAt");
  if (email) lead.email = email;
  if (phone) lead.phone = phone;
  if (assignedToId) lead.assignedToId = assignedToId;
  if (nextActionAt) lead.nextActionAt = nextActionAt;
  if (createdAt) lead.createdAt = createdAt;
  return lead;
}

function parseTimeline(value: unknown): LeadTimelineEvent[] {
  if (!isObject(value) || !Array.isArray(value.events)) return [];
  return value.events.flatMap((candidate): LeadTimelineEvent[] => {
    if (!isObject(candidate)) return [];
    const id = requiredString(candidate, "id");
    const type = requiredString(candidate, "type");
    const occurredAt = requiredString(candidate, "occurredAt");
    if (!id || !type || !occurredAt) return [];
    return [{ id, type, result: requiredString(candidate, "result"), occurredAt }];
  });
}

async function loadJson(endpoint: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(endpoint, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new RequestError(response.status);
  return response.json() as Promise<unknown>;
}

function stateForError(error: unknown): LoadState {
  if (error instanceof RequestError) {
    if (error.status === 401) return { kind: "session" };
    if (error.status === 403) return { kind: "forbidden" };
    if (error.status === 404) return { kind: "missing" };
  }
  return { kind: "error" };
}

export function leadSectionHref(leadId: string, section: string): string {
  return `/leads/${encodeURIComponent(leadId)}/${section}`;
}

function validNamePart(part: string): string {
  const normalized = part.normalize("NFC").trim();
  return /\p{L}/u.test(normalized) ? normalized : "";
}

export function leadDisplayName(lead: Pick<LeadProfileRecord, "firstName" | "lastName">): string {
  return [lead.firstName, lead.lastName].map(validNamePart).filter(Boolean).join(" ") || "Prospect indisponible";
}

function LeadDisplayName({ lead }: Readonly<{ lead: Pick<LeadProfileRecord, "firstName" | "lastName"> }>): React.JSX.Element {
  const parts = [lead.firstName, lead.lastName].map(validNamePart).filter(Boolean);
  if (!parts.length) return <>Prospect indisponible</>;
  return <span className="lead-profile__display-name">{parts.map((part, index) => <React.Fragment key={`${part}-${index}`}>
    {index ? " " : null}<bdi dir="auto">{part}</bdi>
  </React.Fragment>)}</span>;
}

export function leadStatusLabel(status: string): string {
  return statusLabels[status] ?? "Statut à vérifier";
}

export function timelineEventLabel(type: string): string {
  return eventLabels[type] ?? "Événement de suivi";
}

export function leadSourceLabel(source: string): string {
  return sourceLabels[source] ?? source;
}

export function formatDate(value: string | undefined, includeTime = true): string {
  if (!value) return "Non planifiée";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Date à vérifier";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Casablanca",
    day: "numeric",
    month: "short",
    year: includeTime ? undefined : "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function ResultSummary({ result }: Readonly<{ result: string }>): React.JSX.Element | null {
  if (!result) return null;
  return <p>{interactionResultLabel(result)}</p>;
}

const resultLabels: Readonly<Record<string, string>> = {
  CONNECTED: "Contact établi",
  NO_ANSWER: "Injoignable",
  COMPLETED: "Action terminée",
  FOLLOW_UP_REQUIRED: "Relance nécessaire",
  INFORMATION_RECORDED: "Information enregistrée",
  CALL_REQUESTED: "Demande d’appel enregistrée",
  CALL_DIALING: "Numérotation en cours",
  CALL_RINGING: "Sonnerie en cours",
  CALL_ANSWERED: "Appel décroché",
  CALL_ENDED: "Appel terminé",
  CALL_MISSED: "Appel sans réponse",
  CALL_FAILED: "Appel en échec",
  CALL_CANCELLED: "Appel annulé",
};

export function interactionResultLabel(result: string): string {
  const normalized = result.trim().toUpperCase();
  if (!normalized) return "Résultat non renseigné";
  return resultLabels[normalized] ?? result.toLowerCase().replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

export function lastContactSummary(events: readonly LeadTimelineEvent[]): string {
  const contactTypes = new Set(["CRM_CALL", "EXTERNAL_CALL", "PHONE_CALL", "WHATSAPP", "MANUAL_EMAIL", "MEETING", "PHYSICAL_VISIT"]);
  const contacts = events.filter((event) => contactTypes.has(event.type) && event.result.trim());
  const latest = contacts[0];
  if (!latest) return "Aucun contact enregistré";
  if (latest.result.trim().toUpperCase() !== "NO_ANSWER") return interactionResultLabel(latest.result);
  const attempts = contacts.filter((event) => event.result.trim().toUpperCase() === "NO_ANSWER").length;
  return `Injoignable — ${attempts} tentative${attempts > 1 ? "s" : ""}`;
}

function InformationRow({ label, value }: Readonly<{ label: string; value: string }>): React.JSX.Element {
  return <div className="lead-profile__information-row"><dt>{label}</dt><dd>{value || "Non renseigné"}</dd></div>;
}

function ProfileFact({ icon, label, value, emphasized = false }: Readonly<{ icon: React.ReactNode; label: string; value: string; emphasized?: boolean }>): React.JSX.Element {
  return <div className={`lead-profile__fact${emphasized ? " lead-profile__fact--emphasized" : ""}`}>
    <span className="lead-profile__fact-icon" aria-hidden="true">{icon}</span>
    <div><dt>{label}</dt><dd>{value}</dd></div>
  </div>;
}

function RelationRow({ icon, label, value, href }: Readonly<{ icon: React.ReactNode; label: string; value: string; href?: string }>): React.JSX.Element {
  const content = <><span aria-hidden="true">{icon}</span><div><dt>{label}</dt><dd>{value || "Non renseigné"}</dd></div></>;
  return href ? <Link className="lead-profile__relation-row" href={href}>{content}</Link> : <div className="lead-profile__relation-row">{content}</div>;
}

function openCallPanel(triggerId: string): void {
  document.getElementById(triggerId)?.click();
}

function ContactShortcuts({ lead, name, callTriggerId }: Readonly<{ lead: LeadProfileRecord; name: string; callTriggerId: string }>): React.JSX.Element | null {
  if (!lead.email && !lead.phone) return null;
  return <nav className="lead-profile__contact-shortcuts" aria-label="Contacter le prospect">
    <div className="lead-profile__contact-actions">
      {lead.email ? <a href={`mailto:${lead.email}`} aria-label={`Envoyer un email à ${name}`}><EnvelopeSimple size={20} aria-hidden="true" /></a> : null}
      {lead.phone ? <button className="lead-profile__call-shortcut" type="button" aria-label={`Appeler ${name} depuis le CRM`} onClick={() => openCallPanel(callTriggerId)}><Phone size={20} aria-hidden="true" /></button> : null}
    </div>
    <div className="lead-profile__contact-details">
      {lead.email ? <a href={`mailto:${lead.email}`}><EnvelopeSimple size={15} aria-hidden="true" /><bdi dir="auto">{lead.email}</bdi></a> : null}
      {lead.phone ? <button className="lead-profile__call-shortcut" type="button" aria-label={`Appeler ${name} depuis le CRM`} onClick={() => openCallPanel(callTriggerId)}><Phone size={15} aria-hidden="true" /><bdi dir="auto">{lead.phone}</bdi></button> : null}
    </div>
  </nav>;
}

function ProfileHeader({ lead, name, nameNeedsReview, callTriggerId }: Readonly<{ lead: LeadProfileRecord; name: string; nameNeedsReview: boolean; callTriggerId: string }>): React.JSX.Element {
  return <header className="lead-profile__header">
    <div>
      <p className="eyebrow">Lead · {lead.leadCode}</p>
      <h1 aria-label={name}><LeadDisplayName lead={lead} /></h1>
      {nameNeedsReview ? <p className="lead-profile__name-warning">Une partie du nom source est à vérifier.</p> : null}
      <p>Dossier prospect centralisé : informations, actions et historique dans une seule vue.</p>
    </div>
    <ContactShortcuts lead={lead} name={name} callTriggerId={callTriggerId} />
  </header>;
}

function CommercialPanel({ lead, lastContact }: Readonly<{ lead: LeadProfileRecord; lastContact: string }>): React.JSX.Element {
  return <section className="panel lead-profile__commercial" aria-label="Situation commerciale"><dl>
    <ProfileFact icon={<MapPin size={20} />} label="Étape" value={leadStatusLabel(lead.status)} emphasized />
    <ProfileFact icon={<PhoneCall size={20} />} label="Dernier résultat" value={lastContact} emphasized={lastContact.startsWith("Injoignable")} />
    <ProfileFact icon={<UserCircle size={20} />} label="Conseiller principal" value={lead.assignedToId ? "Conseiller attribué" : "Non affecté"} />
    <ProfileFact icon={<ThermometerSimple size={20} />} label="Température" value={lead.temperatureLabel} emphasized={lead.temperature === "HOT"} />
    <ProfileFact icon={<CalendarBlank size={20} />} label="Prochaine action" value={formatDate(lead.nextActionAt)} />
  </dl></section>;
}

function completionProps(onLeadChanged: ((message: string) => void) | undefined, message: string): Readonly<{ onCompleted: () => void }> | Record<string, never> {
  return onLeadChanged ? { onCompleted: () => onLeadChanged(message) } : {};
}

function ProfileActions({ lead, callTriggerId, onLeadChanged, onLeadEdited }: Readonly<{
  lead: LeadProfileRecord;
  callTriggerId: string;
  onLeadChanged?: (message: string) => void;
  onLeadEdited?: (lead: LeadProfileRecord) => void;
}>): React.JSX.Element {
  const assignmentTriggerId = `lead-assignment-${lead.id}`;
  return <nav className="lead-profile__actions" aria-label="Actions principales du lead">
    <LeadEditDrawer lead={lead} {...(onLeadEdited ? { onCompleted: onLeadEdited } : {})} />
    <LeadCallDrawer leadId={lead.id} leadCode={lead.leadCode} triggerId={callTriggerId} {...(lead.phone ? { phone: lead.phone } : {})} {...completionProps(onLeadChanged, "Commande d’appel enregistrée et état relu depuis le serveur.")} />
    <LeadInteractionDrawer leadId={lead.id} leadCode={lead.leadCode} {...completionProps(onLeadChanged, "Interaction enregistrée dans l’historique protégé.")} />
    <LeadAssignmentDrawer leadId={lead.id} leadCode={lead.leadCode} assigned={Boolean(lead.assignedToId)} triggerId={assignmentTriggerId} {...completionProps(onLeadChanged, lead.assignedToId ? "Demande de réaffectation enregistrée." : "Affectation enregistrée.")} />
    <LeadStatusDrawer leadId={lead.id} leadCode={lead.leadCode} currentStatus={lead.status} {...completionProps(onLeadChanged, "Étape commerciale enregistrée.")} />
    <LeadQualificationDrawer leadId={lead.id} leadCode={lead.leadCode} temperatureLabel={lead.temperatureLabel} {...completionProps(onLeadChanged, "Qualification commerciale enregistrée.")} />
    <Link className="secondary-button" href={`/leads/${encodeURIComponent(lead.id)}/appointments`}><CalendarBlank size={18} aria-hidden="true" /> Planifier un rendez-vous</Link>
    <LeadFollowUpDrawer leadId={lead.id} leadCode={lead.leadCode} assigned={Boolean(lead.assignedToId)} assignmentTriggerId={assignmentTriggerId} {...completionProps(onLeadChanged, "Relance planifiée et enregistrée.")} />
  </nav>;
}

function RelationPanel({ lead, callTriggerId }: Readonly<{ lead: LeadProfileRecord; callTriggerId: string }>): React.JSX.Element {
  const contactVisible = Boolean(lead.email || lead.phone);
  const collaboratorCount = lead.collaboratorIds.length;
  const collaborators = collaboratorCount ? `${collaboratorCount} collaborateur${collaboratorCount > 1 ? "s" : ""}` : "Aucun collaborateur";
  return <aside className="panel lead-profile__relation" aria-labelledby="lead-relation-title">
    <div className="lead-profile__panel-heading"><div><p className="eyebrow">Dossier</p><h2 id="lead-relation-title">Relation & dossier</h2></div></div>
    <dl className="lead-profile__relation-list">
      <RelationRow icon={<MapPin size={20} />} label="Campus" value={lead.campus || "Campus à vérifier"} />
      <RelationRow icon={<GraduationCap size={20} />} label="Formation" value={lead.program || "Formation à vérifier"} />
      <RelationRow icon={<Megaphone size={20} />} label="Campagne" value={lead.campaign} />
      <RelationRow icon={<LinkSimple size={20} />} label="Source" value={leadSourceLabel(lead.source)} />
      <RelationRow icon={<FileText size={20} />} label="Candidature" value="Dossier à consulter" href={leadSectionHref(lead.id, "documents")} />
      <RelationRow icon={<FileText size={20} />} label="Documents" value="Consulter les pièces" href={leadSectionHref(lead.id, "documents")} />
      <RelationRow icon={<UsersThree size={20} />} label="Collaborateurs" value={collaborators} href={leadSectionHref(lead.id, "collaborators")} />
    </dl>
    <div className="lead-profile__contact" aria-label="Coordonnées autorisées">
      <h3>Coordonnées</h3>
      {contactVisible ? <div className="lead-profile__contact-list">
        {lead.email ? <a href={`mailto:${lead.email}`}><EnvelopeSimple size={18} aria-hidden="true" /> {lead.email}</a> : null}
        {lead.phone ? <button className="lead-profile__call-shortcut" type="button" aria-label="Appeler depuis le CRM" onClick={() => openCallPanel(callTriggerId)}><Phone size={18} aria-hidden="true" /> {lead.phone}</button> : null}
      </div> : <p>Masquées ou indisponibles pour cette session.</p>}
    </div>
  </aside>;
}

function TimelinePanel({ leadId, events }: Readonly<{ leadId: string; events: readonly LeadTimelineEvent[] }>): React.JSX.Element {
  return <section className="panel lead-profile__timeline" aria-labelledby="lead-timeline-title">
    <div className="lead-profile__panel-heading">
      <div><p className="eyebrow">Historique protégé</p><h2 id="lead-timeline-title">Historique des interactions</h2><p className="lead-profile__panel-description">Chaque événement reste traçable sans réécriture.</p></div>
      <Link className="lead-profile__text-link" href={leadSectionHref(leadId, "timeline")}>Voir tout</Link>
    </div>
    <nav className="lead-profile__timeline-tabs" aria-label="Sections du suivi"><span aria-current="page">Historique</span><Link href={leadSectionHref(leadId, "follow-ups")}>Relances</Link><Link href={leadSectionHref(leadId, "documents")}>Documents</Link></nav>
    {events.length ? <ol>{events.map((event) => <li key={event.id}>
      <span className="lead-profile__timeline-marker" aria-hidden="true" />
      <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
      <h3>{timelineEventLabel(event.type)}</h3>
      <ResultSummary result={event.result} />
    </li>)}</ol> : <div className="lead-profile__empty"><Clock size={22} aria-hidden="true" /><p>Aucun événement visible pour ce lead.</p></div>}
  </section>;
}

export function LeadProfileView({ lead, events, actionMessage, onLeadChanged, onLeadEdited }: Readonly<{ lead: LeadProfileRecord; events: LeadTimelineEvent[]; actionMessage?: string; onLeadChanged?: (message: string) => void; onLeadEdited?: (lead: LeadProfileRecord) => void }>): React.JSX.Element {
  const name = leadDisplayName(lead);
  const nameNeedsReview = [lead.firstName, lead.lastName].some((part) => part.trim() && !validNamePart(part));
  const recentEvents = events.slice(0, 6);
  const lastContact = lastContactSummary(events);
  const callTriggerId = `lead-call-${lead.id}`;

  return <main className="lead-profile">
    <Link className="lead-profile__back" href="/leads"><ArrowLeft size={17} aria-hidden="true" /> Retour aux leads</Link>
    <ProfileHeader lead={lead} name={name} nameNeedsReview={nameNeedsReview} callTriggerId={callTriggerId} />
    <CommercialPanel lead={lead} lastContact={lastContact} />
    <ProfileActions lead={lead} callTriggerId={callTriggerId} {...(onLeadChanged ? { onLeadChanged } : {})} {...(onLeadEdited ? { onLeadEdited } : {})} />

    {actionMessage ? <p className="lead-profile__action-feedback" role="status">{actionMessage}</p> : null}

    <div className="lead-profile__content-grid">
      <RelationPanel lead={lead} callTriggerId={callTriggerId} />
      <TimelinePanel leadId={lead.id} events={recentEvents} />
    </div>

    <details className="panel lead-profile__secondary">
      <summary><GraduationCap size={20} aria-hidden="true" /> Informations secondaires</summary>
      <dl>
        <InformationRow label="Source" value={leadSourceLabel(lead.source)} />
        <InformationRow label="Campagne" value={lead.campaign} />
        <InformationRow label="Créé le" value={formatDate(lead.createdAt, false)} />
      </dl>
    </details>
  </main>;
}

function LoadFailure({ kind, retry }: Readonly<{ kind: "session" | "forbidden" | "missing" | "error"; retry: () => void }>): React.JSX.Element {
  const content = {
    session: ["Session expirée", "Reconnectez-vous pour consulter ce dossier."],
    forbidden: ["Accès refusé", "Ce lead n’est pas disponible dans votre périmètre."],
    missing: ["Lead introuvable", "Ce dossier n’existe pas ou n’est pas visible dans votre périmètre."],
    error: ["Service indisponible", "La fiche n’a pas pu être chargée. Aucune donnée de démonstration ne remplace la réponse de l’API."],
  }[kind];
  return <main className="lead-profile"><Link className="lead-profile__back" href="/leads"><ArrowLeft size={17} aria-hidden="true" /> Retour aux leads</Link><section className="ui-state ui-state--error" role="alert"><UserCircle size={28} aria-hidden="true" /><h1>{content[0]}</h1><p>{content[1]}</p><button type="button" onClick={retry}>Réessayer</button></section></main>;
}

export function LeadProfile({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actionMessage, setActionMessage] = useState<string>();
  const pendingActionMessage = useRef<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    if (revision === 0) setState({ kind: "loading" });
    const encodedLeadId = encodeURIComponent(leadId);
    void Promise.all([
      loadJson(`/api/crm/leads/${encodedLeadId}`, controller.signal),
      loadJson(`/api/crm/leads/${encodedLeadId}/timeline`, controller.signal),
    ]).then(([leadPayload, timelinePayload]) => {
      const lead = parseLead(leadPayload);
      if (!lead) throw new Error("lead_payload_invalid");
      setState({ kind: "ready", lead, events: parseTimeline(timelinePayload) });
      if (revision > 0) {
        setActionMessage(`${pendingActionMessage.current ?? "Action enregistrée."} La fiche et l’historique ont été relus depuis le serveur.`);
        pendingActionMessage.current = undefined;
      }
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (revision === 0) setState(stateForError(error));
      else {
        pendingActionMessage.current = undefined;
        setActionMessage("Action confirmée par le serveur, mais la relecture de la fiche a échoué. Réessayez l’actualisation sans ressaisir l’action.");
      }
    });
    return (): void => controller.abort();
  }, [leadId, revision]);

  if (state.kind === "loading") return <main className="lead-profile" aria-busy="true" aria-live="polite"><span className="sr-only">Chargement de la fiche Lead…</span><div className="lead-profile__loading"><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /></div></main>;
  if (state.kind !== "ready") return <LoadFailure kind={state.kind} retry={() => setRevision((value) => value + 1)} />;
  return <LeadProfileView
    lead={state.lead}
    events={state.events}
    {...(actionMessage ? { actionMessage } : {})}
    onLeadChanged={(message) => { pendingActionMessage.current = message; setActionMessage(undefined); setRevision((value) => value + 1); }}
    onLeadEdited={(lead) => { setActionMessage("Informations du Lead corrigées. La réponse serveur est affichée."); setState({ kind: "ready", lead: { ...state.lead, ...lead }, events: state.events }); }}
  />;
}
