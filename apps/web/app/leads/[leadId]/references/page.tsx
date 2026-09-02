"use client";
import { useParams } from "next/navigation";
import { LeadReferencesClient } from "../../../_components/lead-references-client";
export default function LeadReferencesPage(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <LeadReferencesClient leadId={leadId} />;
}
