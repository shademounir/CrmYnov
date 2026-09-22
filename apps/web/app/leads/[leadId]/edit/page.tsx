"use client";
import { useParams } from "next/navigation";
import { LeadEditPage } from "../lead-edit-workflow";
export default function Page(): React.JSX.Element { const { leadId } = useParams<{ leadId: string }>(); return <LeadEditPage leadId={leadId} />; }
