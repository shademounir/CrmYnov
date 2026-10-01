import { ConnectedResource } from "../_components/connected-resource";
import { BroadcastDraftForm } from "../_components/broadcast-draft-form";

export default function BroadcastsPage(): React.JSX.Element {
  return <main><header><h1>Broadcast interne</h1><p>Diffusion persistante exclusivement destinée aux collaborateurs actifs.</p></header><ConnectedResource endpoint="/api/crm/broadcasts?page=1&pageSize=25" ariaLabel="Historique immuable des broadcasts" emptyMessage="Aucun broadcast." fields={[{ key: "title", label: "Titre" }, { key: "state", label: "État" }, { key: "recipientCount", label: "Destinataires" }, { key: "createdAt", label: "Créé le" }]} itemPathPrefix="/broadcasts" /><section aria-labelledby="draft-heading"><h2 id="draft-heading">Préparer un brouillon</h2><BroadcastDraftForm /></section></main>;
}
