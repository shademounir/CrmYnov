import { Bell } from "@phosphor-icons/react/dist/ssr";
import { NotificationCenter } from "./notification-center";

export default function NotificationsPage(): React.JSX.Element {
  return <main className="notifications-page">
    <header className="ui-page-header notifications-page__header">
      <div>
        <p className="eyebrow">Travail quotidien · Alertes internes</p>
        <h1>Centre de notifications</h1>
        <p>Retrouvez les événements qui demandent votre attention, sans modifier vos droits sur les dossiers.</p>
      </div>
      <span className="notifications-page__icon" aria-hidden="true"><Bell size={24} /></span>
    </header>
    <NotificationCenter />
  </main>;
}
