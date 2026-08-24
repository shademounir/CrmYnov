const stages = ["Prospect", "Contacté", "Qualifié", "Inscrit", "Sans suite"];

export default function CommercialFunnelPage(): React.JSX.Element {
  return <main>
    <h1>Funnel commercial</h1>
    <p>Vue Manager fondée sur l’état courant de chaque lead. L’API applique les droits et le périmètre campus.</p>
    <form method="get" action="/manager/reports/commercial-funnel" aria-label="Filtres du funnel">
      <label>Du <input name="from" type="date" /></label><label>Au <input name="to" type="date" /></label>
      <label>Campus <input name="campus" /></label><label>Campagne <input name="campaign" /></label>
      <label>Formation <input name="program" /></label><label>Source <input name="source" /></label><button type="submit">Actualiser</button>
    </form>
    <section aria-label="États courants"><h2>Volumes par statut</h2><ol>{stages.map((stage) => <li key={stage}>{stage}</li>)}</ol></section>
    <section aria-label="Définitions des indicateurs"><h2>Définitions — commercial-funnel-v1</h2>
      <p>Fuseau d’affichage : Africa/Casablanca. La période forme une cohorte sur la date de création, avec borne de fin exclusive.</p>
      <dl><dt>Contactés ou au-delà</dt><dd>CONTACTED + QUALIFIED + ENROLLED, divisé par les leads uniques de la cohorte.</dd>
        <dt>Qualifiés ou au-delà</dt><dd>QUALIFIED + ENROLLED, divisé par les leads uniques de la cohorte.</dd>
        <dt>Inscrits</dt><dd>ENROLLED, divisé par les leads uniques de la cohorte.</dd></dl>
      <p>Ces taux sont une photographie de l’état courant, pas une reconstitution des transitions historiques.</p>
    </section>
  </main>;
}
