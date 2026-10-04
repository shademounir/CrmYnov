import Link from "next/link";
import { ArrowLeft, CalendarPlus } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "../_components/ui/page-header";
import { AppointmentAgenda } from "./appointment-agenda";
import { AdmissionsAgendaLink } from "./admissions/agenda-link";

export default async function AppointmentsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const { view } = await searchParams;
  const initialView = view === "week" || view === "table" ? view : "day";
  return <main className="appointments-page">
    <PageHeader
      eyebrow="Organisation commerciale"
      title="Rendez-vous"
      description="Préparez les prochains échanges et gardez une lecture claire des rendez-vous du campus."
      actions={<><AdmissionsAgendaLink label="Disponibilités Admissions" /><Link className="secondary-button" href="/leads"><ArrowLeft size={18} aria-hidden="true" /> Planifier depuis un Lead</Link></>}
    />
    <section className="appointments-scope" aria-label="Périmètre de l’agenda">
      <span><CalendarPlus size={18} aria-hidden="true" /><strong>Agenda CRM</strong></span>
      <p>Heure de Casablanca · calendriers externes désactivés</p>
    </section>
    <AppointmentAgenda key={initialView} initialView={initialView} />
  </main>;
}
