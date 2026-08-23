const statuses = ["Prospect", "Contacté", "Qualifié", "Inscrit", "Sans suite"];

export default function LeadStatusPage(): React.JSX.Element {
  return <main><h1>Progression du lead</h1><p>Les clôtures Inscrit et Sans suite nécessitent une validation Manager/Admin et un motif.</p>
    <form><label htmlFor="status">Nouveau statut</label><select id="status" name="status">{statuses.map((status) => <option key={status}>{status}</option>)}</select>
      <label htmlFor="reason">Motif de validation</label><textarea id="reason" name="reason"/><button type="submit">Soumettre la transition</button></form>
    <p>Chaque transition autorisée est ajoutée à la timeline immuable avec auteur et horodatage serveur.</p>
  </main>;
}
