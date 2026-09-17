import { PhoneCall } from "@phosphor-icons/react/dist/ssr";
import { CallQueue } from "./call-queue";

export default function CallQueuePage(): React.JSX.Element {
  return <main className="calls-page">
    <header className="ui-page-header calls-page__header">
      <div>
        <p className="eyebrow">Travail quotidien · Téléphonie</p>
        <h1>Appels à traiter</h1>
        <p>Retrouvez les appels manqués et les rapprochements qui nécessitent une décision humaine.</p>
      </div>
      <span className="calls-page__icon" aria-hidden="true"><PhoneCall size={24} /></span>
    </header>
    <aside className="ui-note calls-page__safeguard" role="note">
      <strong>Mode manuel local</strong>
      <span>Aucun appel, webhook ou enregistrement audio réel n’est déclenché depuis cet écran.</span>
    </aside>
    <CallQueue />
  </main>;
}
