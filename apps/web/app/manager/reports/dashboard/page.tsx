const panels = [
  ["Funnel commercial", "/manager/reports/commercial-funnel", "Volumes et conversions sur une cohorte unique."],
  ["Performance et activité", "/manager/reports/commercial-performance", "Délais, relances et charge, sans scoring disciplinaire."],
  ["Sources et campagnes", "/manager/reports/source-effectiveness", "Efficacité et qualité structurée, sans métrique financière."],
  ["Risques opérationnels", "/manager/reports/operational-risks", "Alertes explicites et bornées sur le périmètre visible."],
  ["Contributions partagées", "/manager/reports/shared-contributions", "Actions secondaires séparées, conversion attribuée au responsable principal."],
] as const;

export default function ManagerReportsDashboardPage(): React.JSX.Element {
  return <main><h1>Tableau de bord Manager</h1><p>Vue consolidée, versionnée et limitée au périmètre autorisé.</p>
    <form method="get" action="/manager/reports/dashboard" aria-label="Filtres consolidés">
      <label>Du <input name="from" type="date" /></label><label>Au <input name="to" type="date" /></label>
      <label>Campus <input name="campus" /></label><button type="submit">Actualiser</button>
    </form>
    <section aria-label="Indicateurs clés"><h2>Indicateurs clés</h2><ul><li>Leads uniques</li><li>Inscriptions</li><li>Leads non affectés</li><li>Relances échues</li><li>Alertes actives</li></ul></section>
    <section aria-label="Tendances temporelles"><h2>Tendances temporelles</h2><p>Créations et inscriptions sont comptées distinctement par lead, dans le fuseau Africa/Casablanca.</p></section>
    <section aria-label="Répartitions"><h2>Répartitions</h2><p>Sources, campagnes, formations et campus utilisent la même cohorte filtrée.</p></section>
    <section aria-label="Performance commerciale"><h2>Performance commerciale</h2><p>Le tableau sépare responsabilité principale et collaboration secondaire.</p></section>
    <section aria-live="polite"><h2>État vide</h2><p>Aucune donnée agrégée pour les filtres sélectionnés.</p></section>
    <p><a href="/reports/manager-dashboard/export">Exporter les agrégats CSV</a></p>
    <section aria-label="Rapports consolidés">{panels.map(([title, href, description]) => <article key={href}><h2>{title}</h2><p>{description}</p><a href={href}>Voir le détail</a></article>)}</section>
    <section><h2>Garde-fous</h2><p>Aucune double attribution, décision financière, commission ou note disciplinaire n’est calculée.</p></section>
  </main>;
}
