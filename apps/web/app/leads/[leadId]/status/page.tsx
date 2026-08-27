"use client";

import { useParams } from "next/navigation";
import { ApiMutationForm } from "../../../_components/api-mutation-form";

function StatusForm(): React.JSX.Element { const { leadId } = useParams<{ leadId: string }>(); return <ApiMutationForm endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}/status`} method="PATCH" submitLabel="Soumettre le changement"><label>Statut<select name="status" required><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label><label>Motif<textarea name="reason" /></label></ApiMutationForm>; }

export default function LeadStatusPage(): React.JSX.Element { return <main><h1>Changer le statut</h1><p>Les clôtures Inscrit et Sans suite restent soumises aux contrôles Manager/Admin côté API et alimentent la timeline immuable.</p><StatusForm /></main>; }
