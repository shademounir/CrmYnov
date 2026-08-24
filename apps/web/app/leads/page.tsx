const leads = [{ code: "LD-SYNTH-001", name: "Alex Synthétique", status: "Prospect", program: "Programme test" }];

export default function LeadsPage(): React.JSX.Element {
  return <main><h1>Files de travail Leads</h1><p>Recherche et filtres combinables, conservés dans une URL partageable.</p>
    <nav aria-label="Vues Leads"><a href="/leads?view=ALL">Tous les leads</a> <a href="/leads?view=MINE">Mes leads</a> <a href="/leads?view=FOLLOW_UP">À relancer</a> <a href="/leads?view=UNASSIGNED">Non affectés</a> <a href="/leads?view=NO_ACTIVITY">Sans activité</a> <a href="/leads?view=CLOSED">Clôturés</a></nav>
    <nav aria-label="Vues par provenance"><a href="/leads?savedView=FORMINATOR_ZAPIER">Forminator/Zapier</a> <a href="/leads?savedView=YNOV_MA_LEGACY">Ynov.ma historique</a> <a href="/leads?savedView=YNOV_COM">Ynov.com</a> <a href="/leads?savedView=PHONE_CALLS">Appels</a> <a href="/leads?savedView=PHYSICAL_VISITS">Visites</a> <a href="/leads?savedView=JOBINTECH">JobInTech</a> <a href="/leads?savedView=LEGACY_RELAUNCH">Relance historique</a> <a href="/leads?savedView=UNCLASSIFIED_SOURCES">Sources non classifiées</a> <a href="/leads?savedView=INCOMPLETE">À compléter</a> <a href="/leads?savedView=IMPORT_ERRORS">Imports en erreur</a></nav>
    <form action="/leads" method="get" aria-label="Recherche et filtres des leads">
      <label>Identité ou identifiant <input name="search" placeholder="Nom, email, téléphone ou LD-…" /></label>
      <label>Conseiller <input name="assignedToId" /></label>
      <label>Statut <select name="status"><option value="">Tous</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label>
      <label>Source <input name="source" /></label><label>Formation <input name="program" /></label>
      <label>Campagne <input name="campaign" /></label><label>Campus <input name="campus" /></label>
      <label>Mode d’affectation <input name="assignmentMode" /></label><label>Lot d’import <input name="importBatchId" /></label>
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
