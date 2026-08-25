const syntheticHistory = [{ id: "broadcast-synthetic-1", title: "Information interne synthétique", state: "Confirmé", recipientCount: 3, author: "Manager synthétique", createdAt: "25 août 2026" }] as const;

export default function BroadcastsPage(): React.JSX.Element {
  return (
    <main>
      <header><h1>Broadcast interne</h1><p>Diffusion exclusivement destinée aux collaborateurs actifs. Aucun email, téléphone ou canal externe n'est utilisé.</p></header>
      <section aria-labelledby="draft-heading">
        <h2 id="draft-heading">Préparer un brouillon</h2>
        <form aria-label="Créer un broadcast interne">
          <label htmlFor="broadcast-title">Titre</label><input id="broadcast-title" name="title" minLength={3} maxLength={120} required />
          <label htmlFor="broadcast-content">Contenu</label><textarea id="broadcast-content" name="content" minLength={3} maxLength={4000} required />
          <label htmlFor="broadcast-campus">Campus</label><select id="broadcast-campus" name="campusId" required><option value="">Sélectionner un périmètre autorisé</option><option value="campus-synthetic">Campus synthétique</option></select>
          <label htmlFor="broadcast-role">Rôle</label><select id="broadcast-role" name="role"><option value="ADMISSIONS">Admissions</option><option value="MANAGER">Manager</option></select>
          <button type="button">Prévisualiser l'audience</button>
          <output aria-live="polite">3 destinataires internes synthétiques — aucune identité affichée</output>
          <label><input type="checkbox" name="confirmed" required /> Je confirme explicitement l'audience figée</label>
          <button type="submit">Confirmer et diffuser</button>
        </form>
      </section>
      <section aria-labelledby="history-heading"><h2 id="history-heading">Historique immuable</h2><ol aria-label="Broadcasts paginés">{syntheticHistory.map((item) => <li key={item.id}><article><h3>{item.title}</h3><p>{item.state} · {item.recipientCount} destinataires · {item.author} · {item.createdAt}</p><a href={`/broadcasts/${item.id}`}>Consulter le résumé autorisé</a></article></li>)}</ol><nav aria-label="Pagination des broadcasts">Page 1</nav></section>
      <aside aria-label="Contrôles du broadcast"><h2>Contrôles appliqués</h2><ul><li>L'audience est figée à la confirmation et ne sera jamais recalculée rétroactivement.</li><li>Un broadcast confirmé ne peut être ni modifié ni supprimé.</li><li>Une erreur après émission exige une correction compensatoire liée et motivée.</li><li>Les liens externes et les contenus exécutables sont refusés.</li></ul></aside>
    </main>
  );
}
