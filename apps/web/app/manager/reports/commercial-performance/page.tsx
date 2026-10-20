import PerformanceReport from "./performance";

const metricDefinitions = [
  ["Taux de contact", "Leads principaux uniques ayant atteint Contacté ou au-delà / leads principaux uniques."],
  ["Taux de qualification", "Leads principaux uniques ayant atteint Qualifié ou Inscrit / leads principaux uniques."],
  ["Taux d’inscription", "Leads principaux uniques inscrits / leads principaux uniques."],
  ["Taux de perte", "Leads principaux uniques actuellement Sans suite / leads principaux uniques."],
  ["Charge active", "Leads principaux uniques actuellement Prospect, Contacté ou Qualifié."],
  ["Traitements anciens", "Dossiers principaux ouverts dont le dernier traitement commercial daté connu précède strictement le seuil figé. Historiques non datés, dossiers jamais traités et clôturés exclus. Les affectations et écritures techniques ne rajeunissent pas ce délai."],
] as const;

export default async function CommercialPerformancePage({ searchParams = Promise.resolve({}) }: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}): Promise<React.JSX.Element> {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  const single = (key: string): string => typeof values[key] === "string" ? values[key] : "";
  return <main>
    <h1>Performance et activité commerciales</h1>
    <p>Vue opérationnelle explicable. Aucun classement disciplinaire ni score opaque n’est calculé.</p>
    <form method="get" action="/manager/reports/commercial-performance" aria-label="Filtres de performance">
      {[...query].filter(([key]) => !["period", "from", "to", "campus", "inactivityHours", "returnTo"].includes(key)).map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
      <label>Période de création CRM <select name="period" defaultValue={single("period") || (single("from") || single("to") ? "custom" : "30d")}><option value="7d">7 derniers jours</option><option value="30d">30 derniers jours</option><option value="90d">90 derniers jours</option><option value="custom">Bornes personnalisées</option></select></label>
      <label>Du (instant inclus, ISO UTC) <input name="from" defaultValue={single("from")} /></label><label>Au (instant exclu, ISO UTC) <input name="to" defaultValue={single("to")} /></label>
      <p>Pour saisir des bornes, choisir « Bornes personnalisées ». Les dates décrivent la création CRM, pas la date d’une activité commerciale.</p>
      <label>Campus <input name="campus" defaultValue={single("campus")} /></label>
      <label>Traitement daté ancien après <input name="inactivityHours" type="number" min="1" max="2160" defaultValue={single("inactivityHours") || "72"} /> heures</label>
      <button type="submit">Actualiser</button>
    </form>
    <PerformanceReport key={query.toString()} query={query.toString()} />
    <section aria-label="Définitions des KPI"><h2>Définitions — commercial-performance-v1</h2>
      <p>Fuseau : Africa/Casablanca. Les divisions par zéro produisent une valeur non calculable, jamais un taux trompeur.</p>
      <dl>{metricDefinitions.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
      <p>Les contributions secondaires sont affichées séparément et ne doublonnent jamais les indicateurs principaux.</p>
    </section>
  </main>;
}
