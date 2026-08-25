type Search = Promise<Record<string, string | string[] | undefined>>;
const value = (input: string | string[] | undefined): string => typeof input === "string" ? input : "";
export default async function AppointmentsPage({ searchParams }: Readonly<{ searchParams: Search }>): Promise<React.JSX.Element> {
  const query = await searchParams; const view = value(query.view) || "week";
  let heading = "Semaine";
  if (view === "day") heading = "Rendez-vous du jour";
  if (view === "table") heading = "Vue tableau";
  return <main><h1>Agenda des rendez-vous</h1><p>Fuseau : Africa/Casablanca. Calendriers externes, visioconférence et communications externes désactivés.</p>
    <nav aria-label="Vues agenda"><a href="?view=day">Jour</a> <a href="?view=week">Semaine</a> <a href="?view=table">Tableau accessible</a></nav>
    <form aria-label="Filtres de rendez-vous"><label>Campus <input name="campus" defaultValue={value(query.campus)} /></label><label>Conseiller <input name="adviserId" defaultValue={value(query.adviserId)} /></label><label>Type <select name="type" defaultValue={value(query.type)}><option value="">Tous</option><option>VISITE_CAMPUS</option><option>ENTRETIEN_ADMISSION</option><option>ENTRETIEN_MOTIVATION</option></select></label><label>État <select name="state" defaultValue={value(query.state)}><option value="">Tous</option><option>PLANIFIE</option><option>CONFIRME</option><option>REPORTE</option><option>ABSENT</option></select></label><input type="hidden" name="view" value={view}/><button type="submit">Filtrer</button></form>
    <section aria-live="polite"><h2>{heading}</h2><table><caption>Rendez-vous synthétiques triés par date puis identifiant</caption><thead><tr><th>Date</th><th>Type</th><th>Mode</th><th>État</th><th>Campus</th><th>Action</th></tr></thead><tbody><tr><td>25/08/2026 10:00</td><td>VISITE_CAMPUS</td><td>SUR_SITE</td><td>PLANIFIE</td><td>Campus synthétique</td><td><a href="/appointments/appointment-synthetic">Ouvrir</a></td></tr></tbody></table></section>
    <nav aria-label="Pagination">Page 1</nav></main>;
}
