const dimensions = ["Source", "Canal", "Campagne", "Formation", "Campus", "Mode de provenance"];
const indicators = ["Volume reçu", "Doublons", "Données incomplètes", "Contact", "Qualification", "Inscription", "Sans suite", "Délai médian", "Non affectés", "À vérifier"];

export default function SourceEffectivenessPage(): React.JSX.Element {
  return <main>
    <h1>Efficacité des sources et campagnes</h1>
    <p>Comparaison opérationnelle agrégée, sans ROI, coût d’acquisition, rentabilité, prime ni commission.</p>
    <form method="get" action="/manager/reports/source-effectiveness" aria-label="Filtres sources et campagnes">
      <label>Du <input name="from" type="date" /></label><label>Au <input name="to" type="date" /></label>
      <label>Source <input name="source" /></label><label>Campagne <input name="campaign" /></label>
      <label>Formation <input name="program" /></label><label>Campus <input name="campus" /></label><button type="submit">Actualiser</button>
    </form>
    <section><h2>Axes d’analyse</h2><ul>{dimensions.map((item) => <li key={item}>{item}</li>)}</ul></section>
    <section><h2>Indicateurs versionnés</h2><ul>{indicators.map((item) => <li key={item}>{item}</li>)}</ul>
      <p>Les taux de doublons et d’incomplétude restent non calculables sans preuve structurée d’ingestion. Les leads sont toujours comptés distinctement.</p></section>
    <section><h2>Fuseau et accès</h2><p>Fuseau Africa/Casablanca. Les listes détaillées restent protégées côté API par le rôle et le périmètre campus.</p></section>
  </main>;
}
