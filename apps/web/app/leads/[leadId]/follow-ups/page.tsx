"use client";

import { useParams } from "next/navigation";
import { ConnectedResource } from "../../../_components/connected-resource";
import { ApiMutationForm } from "../../../_components/api-mutation-form";

function FollowUps(): React.JSX.Element { const { leadId } = useParams<{ leadId: string }>(); return <><ConnectedResource endpoint="/api/crm/follow-ups" ariaLabel="Relances persistantes" emptyMessage="Aucune relance." fields={[{ key: "id", label: "Identifiant" }, { key: "dueAt", label: "Échéance" }, { key: "state", label: "État" }, { key: "ownerId", label: "Responsable" }]} /><ApiMutationForm endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}/follow-ups`} submitLabel="Programmer la relance"><label>Date et heure UTC<input name="dueAt" type="datetime-local" required /></label><label>Motif<textarea name="reason" required /></label></ApiMutationForm></>; }

export default function FollowUpsPage(): React.JSX.Element { return <main><h1>Relances du lead</h1><FollowUps /><p>Reporter ou marquer traitée crée une notification interne unique et une trace d’audit.</p></main>; }
