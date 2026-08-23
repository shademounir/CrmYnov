export default function LeadDetailPage(): React.JSX.Element {
  return <main><h1>Fiche lead synthétique</h1><dl><dt>Identifiant</dt><dd>LD-SYNTH-001</dd><dt>Campagne</dt><dd>Campagne test</dd>
    <dt>Formation</dt><dd>Programme test</dd><dt>Prochaine action</dt><dd>Aucune</dd></dl>
    <p>Les contacts sont masqués lorsque le rôle ne permet pas leur consultation. Les accès directs sont contrôlés par l’API.</p>
    <section aria-label="Demande de réaffectation"><h2>Demander une réaffectation</h2>
      <p>La propriété reste inchangée jusqu’à une décision distincte d’un Manager ou Administrateur.</p>
      <label>Nouveau conseiller <input name="targetUserId" placeholder="Identifiant synthétique" /></label>
      <label>Motif <textarea name="reason" /></label>
      <label><input name="moveOpenTasks" type="checkbox" /> Transférer les tâches et relances ouvertes</label>
      <button type="button">Soumettre la demande</button>
    </section>
    <section aria-label="Décision Manager"><h2>Validation Manager</h2><label>Motif de décision <textarea name="decisionReason" /></label><button type="button">Approuver</button><button type="button">Refuser</button></section>
  </main>;
}
