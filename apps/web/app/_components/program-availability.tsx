"use client";
import { useEffect, useState } from "react";
import type { ReferenceOption } from "./reference-controls";

export function ProgramAvailability({ programId, campuses, revision, onSave }: Readonly<{ programId: string; campuses: ReferenceOption[]; revision: number; onSave: (path: string, method: string, body: unknown) => Promise<void> }>): React.JSX.Element {
  const [campusId, setCampusId] = useState("");
  const [current, setCurrent] = useState<{ active: boolean; version: number } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true; setCurrent(null); setError(false);
    if (campusId) void fetch(`/api/crm/references/${encodeURIComponent(programId)}/availability/${encodeURIComponent(campusId)}`, { cache: "no-store", credentials: "same-origin" }).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { active: boolean; version: number };
      if (live) setCurrent(data);
    }).catch(() => { if (live) setError(true); });
    return (): void => { live = false; };
  }, [programId, campusId, revision]);
  return <form action={async () => { if (current) await onSave(`/${programId}/availability/${campusId}`, "POST", { active: !current.active, expectedVersion: current.version }); }}>
    <label>Disponibilité campus<select value={campusId} required onChange={(event) => setCampusId(event.target.value)}><option value="">Choisir un campus</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.label}</option>)}</select></label>
    {error ? <p role="alert">Disponibilité inaccessible. Vérifiez vos droits sur ce campus.</p> : null}
    {!error && campusId && !current ? <output>Lecture de la disponibilité…</output> : null}
    {current ? <p>Disponibilité actuelle : {current.active ? "active" : "inactive"} · version {current.version}</p> : null}
    <button type="submit" disabled={!current}>{current?.active ? "Désactiver pour ce campus" : "Activer pour ce campus"}</button>
  </form>;
}
