import { ConnectedResource } from "../../_components/connected-resource";
import { AssignmentForm } from "../../_components/assignment-form";

export default function AssignmentPage(): React.JSX.Element { return <main><h1>Pilotage des affectations</h1><p>Charge et alertes issues de l’API persistante ; aucune décision automatique cachée.</p><ConnectedResource endpoint="/api/crm/assignment/dashboard" ariaLabel="Indicateurs d’affectation" emptyMessage="Aucun indicateur disponible." fields={[{ key: "total", label: "Total" }, { key: "assigned", label: "Affectés" }, { key: "unassigned", label: "Non affectés" }, { key: "followUpDue", label: "À relancer" }]} /><AssignmentForm /></main>; }
