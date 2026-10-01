const fields = ["Événement", "Auteur", "Rôle", "Session", "Corrélation", "Résultat", "Horodatage"];

export default function AuditPage(): React.JSX.Element {
  return <main>
    <h1>Piste d’audit</h1>
    <p>Consultation réservée aux rôles Auditor et Super Admin. Les secrets, liens complets et données personnelles inutiles sont exclus.</p>
    <table><thead><tr>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead><tbody><tr><td colSpan={fields.length}>Aucun événement chargé.</td></tr></tbody></table>
  </main>;
}
