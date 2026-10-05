import Link from "next/link";

export default function QuickLeadPage(): React.JSX.Element {
  return <main><p className="eyebrow">Saisie après contact</p><h1>Nouveau Lead après appel ou visite</h1>
    <section className="panel" role="status"><h2>Utilisez la création persistante</h2><p>La saisie rapide et son rapprochement ne sont pas raccordés à la persistance PostgreSQL. Aucun formulaire inactif ni succès en mémoire ne vous est proposé.</p>
      <p>Créez le nouveau Lead par le parcours contrôlé, puis ajoutez l’interaction depuis sa fiche. Une correspondance existante ne doit pas changer son statut, son affectataire ni sa source originale sans action autorisée.</p>
      <Link className="primary-button" href="/leads/new">Ouvrir la création de Lead</Link><Link className="secondary-button" href="/leads">Rechercher un Lead existant</Link>
    </section></main>;
}
