const advisers = [{ id: "synthetic-adviser-a", leads: 12 }, { id: "synthetic-adviser-b", leads: 9 }];

export default function ManagerAssignmentPage(): React.JSX.Element {
  return <main>
    <h1>Pilotage des affectations</h1>
    <p>Vue Manager synthétique. L’API applique le RBAC et reste l’autorité finale.</p>
    <section aria-label="Indicateurs d’affectation">
      <h2>Indicateurs</h2><dl><dt>Leads</dt><dd>25</dd><dt>Non affectés</dt><dd>4</dd><dt>À relancer</dt><dd>3</dd><dt>Demandes en attente</dt><dd>1</dd></dl>
    </section>
    <section><h2>Charge par conseiller</h2><table><thead><tr><th>Conseiller</th><th>Leads actifs</th></tr></thead><tbody>{advisers.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.leads}</td></tr>)}</tbody></table></section>
    <section><h2>Moteur</h2><p>Round-robin actif — configuration versionnée et historique expurgé.</p><a href="/admin/assignment">Configurer ou simuler</a></section>
    <section><h2>Actions</h2><a href="/leads">Affecter un lead ou un lot</a><p>Les réaffectations en attente nécessitent une décision Manager/Admin distincte.</p></section>
    <section><h2>Alertes</h2><output>Les leads sans candidat éligible restent non affectés et sont signalés sans mutation silencieuse.</output></section>
  </main>;
}
