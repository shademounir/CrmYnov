"use client";
export default function ErrorState({ reset }: { error: Error; reset: () => void }): React.JSX.Element { return <main role="alert"><h1>Tableau de bord indisponible</h1><p>Les indicateurs n’ont pas pu être chargés. Aucune donnée partielle n’est présentée.</p><button type="button" onClick={reset}>Réessayer</button></main>; }
