"use client";
import { useParams } from "next/navigation";
import { LeadWorkflowPage } from "../lead-workflow-page";
function Route(): React.JSX.Element { const { leadId } = useParams<{ leadId: string }>(); return <LeadWorkflowPage leadId={leadId} surface="closure" />; }
export default function ClosurePage(): React.JSX.Element { return <Route />; }
