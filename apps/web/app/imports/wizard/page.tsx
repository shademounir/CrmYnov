const steps = ["Fichier", "Feuille", "Profil", "Mapping", "Prévisualisation", "Qualité et doublons", "Affectation", "Dry-run", "Confirmation", "Rapport final"];

export default function ImportWizardPage(): React.JSX.Element {
  return <main><h1>Assistant d’import CSV/XLSX</h1><p>Le fichier brut est analysé en mémoire puis supprimé. Aucune donnée réelle n’est conservée.</p>
    <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
    <form><label>Profil<select name="profile"><option>FORMINATOR_ZAPIER</option><option>YNOV_MA_LEGACY</option><option>YNOV_COM</option><option>JOBINTECH</option><option>LEGACY_RELAUNCH</option><option>CUSTOM_CONTROLLED</option></select></label>
      <label>Fichier synthétique<input type="file" name="file" accept=".csv,.xlsx"/></label>
      <label><input type="checkbox" name="confirm"/>Je confirme les compteurs, collisions, affectations et le dry-run sans mutation.</label>
      <button type="submit">Confirmer et produire le rapport</button></form>
    <p>La confirmation reste verrouillée tant que toutes les preuves ne sont pas réconciliées.</p></main>;
}
