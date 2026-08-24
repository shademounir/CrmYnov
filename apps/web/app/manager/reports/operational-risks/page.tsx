const queues = ["Leads non affectés", "Première interaction en retard", "Relances échues", "Clôtures en attente", "Réaffectations en attente"];

export default function OperationalRisksPage(): React.JSX.Element {
  return <main><h1>Charge, réactivité et files à risque</h1>
    <p>Alertes opérationnelles explicables uniquement : aucun score disciplinaire, classement RH, prime ou décision financière.</p>
    <form method="get" action="/manager/reports/operational-risks" aria-label="Seuils opérationnels">
      <label>Première interaction (heures) <input name="noInteractionHours" type="number" min="1" max="720" defaultValue="24" /></label>
      <label>Alerte capacité (%) <input name="capacityWarningPercent" type="number" min="50" max="100" defaultValue="90" /></label>
      <label>Écart de charge (leads) <input name="loadGap" type="number" min="1" max="100" defaultValue="5" /></label>
      <label>Risque source (%) <input name="sourceRiskPercent" type="number" min="1" max="100" defaultValue="30" /></label>
      <label>Volume source minimal <input name="minSourceVolume" type="number" min="1" max="1000" defaultValue="3" /></label>
      <button type="submit">Recalculer</button>
    </form>
    <section><h2>Files contrôlées</h2><ul>{queues.map((queue) => <li key={queue}>{queue}</li>)}</ul></section>
    <section><h2>Lecture des alertes</h2><p>Chaque alerte expose son seuil, son motif stable, un volume agrégé et un lien filtré soumis au RBAC et au périmètre campus.</p></section>
  </main>;
}
