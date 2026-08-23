const syntheticCandidates = ["Conseiller synthétique A", "Conseiller synthétique B"];

export default function AssignmentConfigurationPage(): React.JSX.Element {
  return <main>
    <h1>Configuration des affectations</h1>
    <p>Réservé aux Managers et Administrateurs. Toute modification est historisée.</p>
    <form aria-label="Configuration du moteur d’affectation">
      <label>État <select name="enabled" defaultValue="true"><option value="true">Activé</option><option value="false">Désactivé</option></select></label>
      <label>Stratégie <select name="strategy" defaultValue="ROUND_ROBIN"><option value="ROUND_ROBIN">Round-robin</option><option value="CONTROLLED_RANDOM">Aléatoire contrôlé</option></select></label>
      <fieldset><legend>Conseillers éligibles</legend>{syntheticCandidates.map((candidate) => <label key={candidate}><input type="checkbox" defaultChecked />{candidate}</label>)}</fieldset>
      <label>Capacité maximale <input name="capacity" type="number" min="1" defaultValue="25" /></label>
      <button type="button">Simuler sans modifier</button>
      <button type="button">Enregistrer la configuration</button>
    </form>
    <section><h2>Garanties</h2><p>Les comptes inactifs, suspendus, exclus ou à capacité atteinte sont écartés. Une ambiguïté de règles bloque l’affectation.</p></section>
  </main>;
}
