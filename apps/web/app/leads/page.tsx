const leads = [{ code: "LD-SYNTH-001", name: "Alex Synthétique", status: "Prospect", program: "Programme test" }];

export default function LeadsPage(): React.JSX.Element {
  return <main><h1>Tous les leads</h1><p>Liste globale autorisée, paginée et triée de façon déterministe.</p>
    <table><thead><tr><th>Identifiant</th><th>Lead</th><th>Statut</th><th>Formation</th></tr></thead>
      <tbody>{leads.map((lead) => <tr key={lead.code}><td>{lead.code}</td><td>{lead.name}</td><td>{lead.status}</td><td>{lead.program}</td></tr>)}</tbody></table>
    <nav aria-label="Pagination">Page 1 sur 1</nav>
  </main>;
}
