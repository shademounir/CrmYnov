import Link from "next/link";
import { ReassignmentHistory } from "../../_components/reassignment-history";
import { AssignmentDashboard } from "./assignment-dashboard";

export default function AssignmentPage(): React.JSX.Element {
  return <main className="assignment-page"><header><p className="eyebrow">Équipe commerciale</p><h1>Pilotage des affectations</h1><p>Charge et demandes issues de l’API persistante ; aucune décision automatique cachée.</p></header>
    <nav className="assignment-page__links" aria-label="Parcours d’affectation"><Link className="secondary-button" href="/leads?view=UNASSIGNED">Ouvrir la file À affecter</Link><Link className="secondary-button" href="/admin/assignment">Configuration par campus</Link></nav>
    <AssignmentDashboard /><section className="panel"><ReassignmentHistory /></section>
    <p>La file affiche au plus les 100 premières demandes autorisées dans votre périmètre. La pagination au-delà de cette limite n’est pas encore disponible ; consultez directement la fiche du Lead si nécessaire.</p>
    <p>Pour une affectation manuelle, ouvrez un dossier de la file À affecter : la fiche ne propose que les conseillers éligibles. La réaffectation reste une demande motivée suivie d’une décision distincte.</p>
  </main>;
}
