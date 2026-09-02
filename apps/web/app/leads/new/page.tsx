import { ApiMutationForm } from "../../_components/api-mutation-form";
import { LeadReferenceSelectors } from "../../_components/reference-controls";

export default function NewLeadPage(): React.JSX.Element { return <main><h1>Créer un lead</h1><p>Création persistante via l’API ; la déduplication est exécutée côté serveur.</p><ApiMutationForm endpoint="/api/crm/leads" submitLabel="Créer le lead"><label>Prénom<input name="firstName" required /></label><label>Nom<input name="lastName" required /></label><label>Email<input name="email" type="email" /></label><label>Téléphone<input name="phone" /></label><LeadReferenceSelectors /><label>Niveau<input name="educationLevel" required /></label><label>Source<input name="source" required /></label></ApiMutationForm></main>; }
