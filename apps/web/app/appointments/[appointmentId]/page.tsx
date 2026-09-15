import { AppointmentDetail } from "./appointment-detail";

export default async function AppointmentDetailPage({ params }: Readonly<{ params: Promise<{ appointmentId: string }> }>): Promise<React.JSX.Element> {
  const { appointmentId } = await params;
  return <AppointmentDetail appointmentId={appointmentId} />;
}
