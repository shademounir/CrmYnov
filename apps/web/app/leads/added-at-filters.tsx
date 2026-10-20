"use client";

import React from "react";
import { addedPeriod, addedPeriodQuery, addedPreset } from "./added-at-period";

/** Parent navigation changes the whole cohort, never only one embedded card. */
export function AddedAtFilters({ current, path, directory = false, onChange }: Readonly<{ current: URLSearchParams; path: string; directory?: boolean; onChange?: (query: URLSearchParams) => void }>): React.JSX.Element {
  const [start, setStart] = React.useState(""), [end, setEnd] = React.useState(""), [error, setError] = React.useState("");
  function select(period: { from: string; to: string }): void {
    const next = addedPeriodQuery(current, period, directory);
    setError("");
    if (onChange) onChange(next);
    else globalThis.window.location.assign(`${path}?${next}`);
  }
  return <section aria-label="Période d’ajout au CRM" className="added-at-filters">
    <strong>Ajouté le · période CRM</strong>
    <div className="saved-views">{([[1, "Aujourd’hui"], [7, "7 derniers jours"], [30, "30 derniers jours"]] as const).map(([days, label]) => <button key={days} className="secondary-button" type="button" onClick={(): void => select(addedPreset(days, new Date()))}>{label}</button>)}</div>
    <details><summary>Plage personnalisée</summary><div className="filter-grid"><label>Ajouté à partir du<input type="date" value={start} onChange={event => setStart(event.target.value)} /></label><label>Ajouté jusqu’au (inclus)<input type="date" value={end} onChange={event => setEnd(event.target.value)} /></label><button className="secondary-button" type="button" disabled={!start || !end} onClick={(): void => { try { select(addedPeriod(start, end)); } catch { setError("Vérifiez les dates de la plage d’ajout."); } }}>Appliquer la plage</button></div></details>
    {error ? <p role="alert">{error}</p> : null}
    <p><small>Journées de Casablanca, aujourd’hui inclus. Bornes figées à la sélection, fin exclue. Les autres filtres sont conservés. La réception de référence et le retard de 24 h ne sont pas modifiés.</small></p>
  </section>;
}
