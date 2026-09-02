"use client";
import { useParams } from "next/navigation";
import { LeadTagsClient } from "../../../_components/lead-tags-client";
export default function LeadTagsPage(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <LeadTagsClient leadId={leadId} />;
}
