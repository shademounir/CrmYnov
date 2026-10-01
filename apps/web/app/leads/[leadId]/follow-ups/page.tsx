"use client";
import { useParams } from "next/navigation";
import { LeadWorkflowPage } from "../lead-workflow-page";
function Route(): React.JSX.Element { const { leadId } = useParams<{ leadId: string }>(); return <LeadWorkflowPage leadId={leadId} surface="follow-up" />; }
export default function FollowUpsPage(): React.JSX.Element { return <Route />; }
