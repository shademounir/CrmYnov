"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "../../_components/ui/page-header";
import { ProgramAvailability } from "../../_components/program-availability";
import { loadReferences, referenceFormText, referenceLabels, type ReferenceKind, type ReferenceOption } from "../../_components/reference-controls";

export default function ReferencesPage(): React.JSX.Element {
  const [kind, setKind] = useState<ReferenceKind>("TAG");
  const [rows, setRows] = useState<ReferenceOption[]>([]);
  const [campuses, setCampuses] = useState<ReferenceOption[]>([]);
  const [editing, setEditing] = useState<ReferenceOption | null>(null);
  const [scope, setScope] = useState("GLOBAL");
  const [state, setState] = useState("loading");
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let current = true; setState("loading");
    void Promise.all([loadReferences(kind, undefined, true), loadReferences("CAMPUS")]).then(([items, campus]) => {
      if (current) { setRows(items); setCampuses(campus); setState("ready"); }
    }).catch(() => { if (current) setState("error"); });
    return (): void => { current = false; };
  }, [kind, revision]);
  async function mutate(path: string, method: string, body: unknown): Promise<void> {
    setState("loading"); setSaved(false);
    try {
      const response = await fetch(`/api/crm/references${path}`, { method, cache: "no-store", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setState(response.status === 409 ? "conflict" : "error"); return; }
      setEditing(null); setSaved(true); setRevision((value) => value + 1);
    } catch { setState("error"); }
  }
  async function save(form: FormData): Promise<void> {
    const data = { label: referenceFormText(form, "label"), scope, campusId: scope === "CAMPUS" ? referenceFormText(form, "campusId") : null, aliases: referenceFormText(form, "aliases").split(",").map((item) => item.trim()).filter(Boolean) };
    await mutate(editing ? `/${editing.id}` : "", editing ? "PATCH" : "POST", editing ? { ...data, expectedVersion: editing.version } : { ...data, code: referenceFormText(form, "code"), kind });
  }
  return <main><PageHeader eyebrow="Administration" title="Tags et référentiels" description="Valeurs gouvernées. Les droits sont contrôlés côté serveur ; les archives restent conservées." />
    <Link href="/admin/users">Retour aux utilisateurs</Link>
    <section className="panel reference-admin"><label>Référentiel<select value={kind} onChange={(event) => { setKind(event.target.value as ReferenceKind); setEditing(null); setScope("GLOBAL"); }}>{Object.entries(referenceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {state === "loading" ? <output>Chargement / enregistrement…</output> : null}
      {state === "error" ? <p role="alert">Opération refusée ou service indisponible. Vérifiez vos droits et les valeurs saisies.</p> : null}
      {state === "conflict" ? <p role="alert">Conflit de version, alias ambigu ou valeur déjà utilisée. Actualisez avant de réessayer.</p> : null}
      {saved && state === "ready" ? <output>Modification enregistrée et auditée.</output> : null}
      <button type="button" onClick={() => setRevision((value) => value + 1)}>Actualiser</button>
      <form key={`${kind}-${editing?.id ?? "new"}`} action={save} className="reference-fields"><h2>{editing ? "Modifier la définition" : "Créer une définition"}</h2>
        {!editing ? <label>Code stable<input name="code" required maxLength={120} /></label> : <p>Code stable : {editing.code}</p>}
        <label>Libellé<input name="label" required maxLength={120} defaultValue={editing?.label ?? ""} /></label>
        {kind === "TAG" || kind === "CAMPAIGN" ? <label>Portée<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="GLOBAL">Globale — Super Admin</option><option value="CAMPUS">Campus</option></select></label> : <p>Définition globale — Super Admin</p>}
        {scope === "CAMPUS" ? <label>Campus<select name="campusId" required defaultValue={editing?.campusId ?? ""}><option value="">Choisir</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.label}</option>)}</select></label> : null}
        <label>Ajouter des alias explicites (séparés par une virgule)<input name="aliases" maxLength={1000} /></label>
        <p>Les anciens libellés et alias restent conservés. Bourses autorisées : 20, 30 ou 40.</p>
        <button disabled={state === "loading"} type="submit">Enregistrer la définition</button>
        {editing ? <button type="button" onClick={() => { setEditing(null); setScope("GLOBAL"); }}>Annuler la modification</button> : null}
      </form>
      <h2>Définitions et archives</h2>{!rows.length && state === "ready" ? <p>Aucune valeur disponible.</p> : null}
      <ul className="reference-list">{rows.map((row) => <li key={row.id}><h3>{row.label}</h3><p>{row.code} · {row.scope} · {row.state} · v{row.version}</p>
        {row.state !== "LEGACY" ? <><button type="button" onClick={() => { setEditing(row); setScope(row.scope); }}>Modifier {row.label}</button><button type="button" disabled={state === "loading"} onClick={() => void mutate(`/${row.id}`, "PATCH", { state: row.state === "ACTIVE" ? "ARCHIVED" : "ACTIVE", expectedVersion: row.version })}>{row.state === "ACTIVE" ? "Archiver" : "Restaurer"} {row.label}</button></> : <p>Historique immuable, non sélectionnable.</p>}
        {kind === "PROGRAM" && row.state === "ACTIVE" ? <ProgramAvailability programId={row.id} campuses={campuses} revision={revision} onSave={mutate} /> : null}
      </li>)}</ul>
      <details><summary>Inventaire historique — Super Admin</summary><p>Crée seulement des entrées LEGACY archivées pour les chaînes inconnues. Aucun lead n’est modifié.</p><button type="button" disabled={state === "loading"} onClick={() => void mutate("/legacy-inventory", "POST", {})}>Confirmer l’inventaire LEGACY sans réécriture</button></details>
    </section>
  </main>;
}
