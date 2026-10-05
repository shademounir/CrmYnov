import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "../../_components/ui/page-header";
import { AdmissionsAgenda } from "./admissions-agenda";

export default function AdmissionsAgendaPage(): React.JSX.Element {
  return <main className="admissions-page"><PageHeader eyebrow="Relation Ynov · Admissions" title="Disponibilités et rendez-vous" description="Préparez votre agenda, recevez les demandes et décidez sans chevauchement." actions={<Link className="secondary-button" href="/appointments"><ArrowLeft size={18} aria-hidden="true" /> Agenda des rendez-vous</Link>} /><p className="admissions-notice">Heure de Casablanca · agenda CRM manuel. Calendrier externe, email, SMS et appels automatiques désactivés.</p><AdmissionsAgenda /></main>;
}
