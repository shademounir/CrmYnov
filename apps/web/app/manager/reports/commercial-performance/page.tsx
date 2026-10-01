const metricDefinitions = [
  ["Taux de contact", "Leads principaux uniques ayant atteint Contacté ou au-delà / leads principaux uniques."],
  ["Taux de qualification", "Leads principaux uniques ayant atteint Qualifié ou Inscrit / leads principaux uniques."],
  ["Taux d’inscription", "Leads principaux uniques inscrits / leads principaux uniques."],
  ["Taux de perte", "Leads principaux uniques actuellement Sans suite / leads principaux uniques."],
  ["Charge active", "Leads principaux uniques actuellement Prospect, Contacté ou Qualifié."],
] as const;

export default function CommercialPerformancePage(): React.JSX.Element {
  return <main>
    <h1>Performance et activité commerciales</h1>
    <p>Vue opérationnelle explicable. Aucun classement disciplinaire ni score opaque n’est calculé.</p>
    <form method="get" action="/manager/reports/commercial-performance" aria-label="Filtres de performance">
      <label>Du <input name="from" type="date" /></label><label>Au <input name="to" type="date" /></label>
      <label>Campus <input name="campus" /></label>
      <label>Inactivité après <input name="inactivityHours" type="number" min="1" max="2160" defaultValue="72" /> heures</label>
      <button type="submit">Actualiser</button>
    </form>
    <section aria-label="Performance par commercial"><h2>Tableau par commercial</h2>
      <table><thead><tr><th>Commercial</th><th>Leads principaux</th><th>Contributions secondaires</th><th>Charge active</th><th>Relances en retard</th><th>Sans interaction</th></tr></thead>
        <tbody><tr><td colSpan={6}>Les données autorisées sont chargées depuis l’API sécurisée.</td></tr></tbody></table>
    </section>
    <section aria-label="Définitions des KPI"><h2>Définitions — commercial-performance-v1</h2>
      <p>Fuseau : Africa/Casablanca. Les divisions par zéro produisent une valeur non calculable, jamais un taux trompeur.</p>
      <dl>{metricDefinitions.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
      <p>Les contributions secondaires sont affichées séparément et ne doublonnent jamais les indicateurs principaux.</p>
    </section>
  </main>;
}
