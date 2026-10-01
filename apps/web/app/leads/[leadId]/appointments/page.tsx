import { LeadAppointmentForm } from "./lead-appointment-form";

export default async function LeadAppointmentsPage({ params }: Readonly<{ params: Promise<{ leadId: string }> }>): Promise<React.JSX.Element> {
  const { leadId } = await params;
  return <LeadAppointmentForm leadId={leadId} />;
}
