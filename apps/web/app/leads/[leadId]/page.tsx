"use client";

import { useParams } from "next/navigation";
import { LeadProfile } from "./lead-profile";

export { leadSectionHref } from "./lead-profile";

export default function LeadDetailPage(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <LeadProfile leadId={leadId} />;
}
