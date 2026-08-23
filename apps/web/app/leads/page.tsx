const leads = [{ code: "LD-SYNTH-001", name: "Alex Synthétique", status: "Prospect", program: "Programme test" }];

export default function LeadsPage(): React.JSX.Element {
  return <main><h1>Tous les leads</h1><p>Recherche et filtres combinables, conservés dans une URL partageable.</p>
    <form action="/leads" method="get" aria-label="Recherche et filtres des leads">
      <label>Identité ou identifiant <input name="search" placeholder="Nom, email, téléphone ou LD-…" /></label>
      <label>Conseiller <input name="assignedToId" /></label>
      <label>Statut <select name="status"><option value="">Tous</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label>
      <label>Source <input name="source" /></label><label>Formation <input name="program" /></label>
      <label>Campagne <input name="campaign" /></label><label>Campus <input name="campus" /></label>
      <label>Du <input name="createdFrom" type="date" /></label><label>Au <input name="createdTo" type="date" /></label>
      <label>Trier par <select name="sortBy"><option value="createdAt">Date</option><option value="leadCode">Identifiant</option><option value="lastName">Nom</option><option value="status">Statut</option></select></label>
      <input name="page" type="hidden" value="1" /><input name="pageSize" type="hidden" value="25" /><button type="submit">Appliquer</button>
    </form>
    <table><thead><tr><th>Identifiant</th><th>Lead</th><th>Statut</th><th>Formation</th></tr></thead>
      <tbody>{leads.map((lead) => <tr key={lead.code}><td><input type="checkbox" aria-label={`Sélectionner ${lead.code}`} /> {lead.code}</td><td>{lead.name}</td><td>{lead.status}</td><td>{lead.program}</td></tr>)}</tbody></table>
    <section aria-label="Affectation manuelle Manager"><h2>Affecter la sélection</h2>
      <label>Mode <select defaultValue="FIXED"><option value="FIXED">Conseiller fixe</option><option value="ROUND_ROBIN">Round-robin</option><option value="CONTROLLED_RANDOM">Aléatoire contrôlé</option></select></label>
      <label>Conseiller cible <input placeholder="Identifiant synthétique" /></label>
      <button type="button">Prévisualiser sans modifier</button><button type="button">Confirmer l’affectation</button>
    </section>
    <nav aria-label="Pagination">Page 1 sur 1</nav>
  </main>;
}
