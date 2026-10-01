"use client";
import { useParams } from "next/navigation";
import { LeadWorkflowPage } from "../lead-workflow-page";
function Route(): React.JSX.Element { const { leadId } = useParams<{ leadId: string }>(); return <LeadWorkflowPage leadId={leadId} surface="status" />; }
export default function LeadStatusPage(): React.JSX.Element { return <Route />; }
