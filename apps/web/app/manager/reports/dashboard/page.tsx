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
    <section aria-label="Rapports consolidés">{panels.map(([title, href, description]) => <article key={href}><h2>{title}</h2><p>{description}</p><a href={href}>Voir le détail</a></article>)}</section>
    <section><h2>Garde-fous</h2><p>Aucune double attribution, décision financière, commission ou note disciplinaire n’est calculée.</p></section>
  </main>;
}
