import { AdmissionsBookingDetail } from "../booking-detail";
export default async function AdmissionsBookingPage({ params }: Readonly<{ params: Promise<{ bookingId: string }> }>): Promise<React.JSX.Element> { const { bookingId } = await params; return <AdmissionsBookingDetail bookingId={bookingId} />; }
