"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type View = { id: string; name: string; filters: Record<string, string>; version: number };

function queryFor(filters: Record<string, string>): string {
  const query = new URLSearchParams(filters); query.set("page", "1"); query.set("pageSize", "25"); return `/leads?${query.toString()}`;
}

export function SavedViews({ current }: Readonly<{ current: Record<string, string> }>): React.JSX.Element {
  const [views, setViews] = useState<View[]>([]); const [name, setName] = useState(""); const [state, setState] = useState<"idle" | "saving" | "error" | "success">("idle");
  const filters = useMemo(() => Object.fromEntries(Object.entries(current).filter(([key, value]) => key !== "page" && key !== "pageSize" && value)), [current]);
  useEffect(() => { void fetch("/api/crm/lead-views", { credentials: "include" }).then(async (response) => response.ok ? response.json() as Promise<View[]> : []).then(setViews).catch(() => setViews([])); }, []);
  async function save(): Promise<void> {
    setState("saving"); const response = await fetch("/api/crm/lead-views", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, filters }) });
    if (!response.ok) { setState("error"); return; } const created = await response.json() as View; setViews((items) => [created, ...items]); setName(""); setState("success");
  }
  async function remove(view: View): Promise<void> { if (!window.confirm(`Supprimer la vue « ${view.name} » ?`)) return; const response = await fetch(`/api/crm/lead-views/${encodeURIComponent(view.id)}`, { method: "DELETE", credentials: "include" }); if (response.ok) setViews((items) => items.filter((item) => item.id !== view.id)); else setState("error"); }
  return <section className="saved-view-controls" aria-label="Vues enregistrées">
    <div className="saved-view-controls__row"><strong>Mes vues</strong><Link className="secondary-button" href="/leads">Réinitialiser les filtres</Link></div>
    <div className="saved-view-controls__row saved-view-controls__list">{views.length === 0 ? <span className="saved-view-empty">Aucune vue enregistrée</span> : views.map((view) => <span className="saved-view-chip" key={view.id}><Link href={queryFor(view.filters)}>{view.name}</Link><button type="button" aria-label={`Supprimer la vue ${view.name}`} onClick={() => void remove(view)}>×</button></span>)}</div>
    <div className="saved-view-controls__row"><label className="sr-only" htmlFor="saved-view-name">Nom de la vue</label><input id="saved-view-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Nom de la vue" /><button type="button" className="secondary-button" disabled={!name.trim() || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Enregistrement…" : "Enregistrer la vue"}</button></div>
    <p className="saved-view-status" role="status">{state === "error" ? "La vue n’a pas pu être enregistrée ou supprimée." : state === "success" ? "Vue enregistrée." : "Les vues ne conservent que les filtres autorisés."}</p>
  </section>;
}
