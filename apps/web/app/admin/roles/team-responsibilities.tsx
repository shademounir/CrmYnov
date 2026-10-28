"use client";
import { useState } from "react";
import { permissionRequest } from "./permission-types";
interface Responsibility { id: string; teamId: string; campusId: string; managerId: string; active: boolean; version: number }
export function TeamResponsibilities({ campuses }: { campuses: { id: string; code: string }[] }): React.JSX.Element {
  const [items, setItems] = useState<Responsibility[]>([]);
  const [team, setTeam] = useState(""); const [manager, setManager] = useState(""); const [campus, setCampus] = useState("");
  const [version, setVersion] = useState(0); const [active, setActive] = useState(true); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [reading, setReading] = useState(false); const [loaded, setLoaded] = useState(false);
  async function load(save: boolean): Promise<void> {
    setBusy(true); setReading(!save); setError(""); setNotice("");
    if (!save) setLoaded(false);
    try {
      const result = await permissionRequest<{ responsibilities: Responsibility[] }>("team-responsibilities", save ? { teamId: team, managerId: manager, campusId: campus, active, expectedVersion: version, confirmed } : undefined);
      if (!Array.isArray(result?.responsibilities)) throw new Error("La réponse des responsabilités est invalide. Rechargez avant toute modification.");
      setItems(result.responsibilities); setLoaded(true); setConfirmed(false);
      if (save) { setVersion((value) => value + 1); setNotice("Responsabilité enregistrée et auditée ; aucune appartenance déduite."); }
      else setNotice(result.responsibilities.length === 1 ? "1 responsabilité chargée." : `${result.responsibilities.length} responsabilités chargées.`);
    } catch (error_) { setLoaded(false); setConfirmed(false); setError(error_ instanceof Error ? error_.message : "Responsabilité indisponible."); } finally { setReading(false); setBusy(false); }
  }
  return <section className="panel permission-team" aria-label="Responsabilités explicites des équipes" aria-busy={busy}>
    <h2>Responsabilités d’équipe — Super Admin</h2>
    <p>Un teamId ne désigne pas un responsable. TEAM pour un Manager exige cette relation active, vérifiée côté serveur. Aucune relation existante n’est créée implicitement.</p>
    <button className="secondary-button" disabled={busy} type="button" onClick={() => void load(false)}>{reading ? "Chargement des responsabilités…" : "Charger les responsabilités"}</button>
    {error ? <p role="alert">{error} Aucune nouvelle lecture n’est confirmée. Rechargez avant toute nouvelle modification.</p> : null}{notice ? <p role="status" aria-live="polite" aria-atomic="true">{notice}</p> : null}
    {!loaded && !busy && !error ? <p>Chargez les responsabilités avant de préparer une modification.</p> : null}
    {loaded && !busy && !error && items.length === 0 ? <p>Aucune responsabilité enregistrée dans ce périmètre. Aucune responsabilité n’est déduite d’une appartenance à une équipe.</p> : null}
    <ul>{items.map((item) => <li key={item.id}><button className="secondary-button" disabled={busy || !loaded} type="button" onClick={() => { setTeam(item.teamId); setManager(item.managerId); setCampus(item.campusId); setVersion(item.version); setActive(item.active); setConfirmed(false); }}>{item.teamId} · {item.managerId} · v{item.version} · {item.active ? "Active" : "Révoquée"}</button></li>)}</ul>
    <div className="permission-toolbar">
      <label>Équipe existante<input maxLength={64} value={team} disabled={busy} onChange={(event) => { setTeam(event.target.value); setVersion(0); setConfirmed(false); }} /></label>
      <label>Identifiant du Manager<input maxLength={36} value={manager} disabled={busy} onChange={(event) => { setManager(event.target.value); setVersion(0); setConfirmed(false); }} /></label>
      <label>Campus de responsabilité<select aria-label="Campus de responsabilité" value={campus} disabled={busy} onChange={(event) => { setCampus(event.target.value); setVersion(0); setConfirmed(false); }}><option value="">Sélectionner</option>{campuses.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
      <label className="permission-toggle"><input type="checkbox" checked={active} disabled={busy} onChange={(event) => { setActive(event.target.checked); setConfirmed(false); }} />Responsabilité active</label>
      <label className="permission-toggle"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Je confirme cette responsabilité ou sa révocation.</label>
      <button className="primary-button" disabled={busy || !loaded || !confirmed || !campus || !team || !manager} type="button" onClick={() => void load(true)}>Enregistrer la responsabilité v{version + 1}</button>
    </div>
  </section>;
}
