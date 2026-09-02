"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { loadReferences, type ReferenceOption } from "./reference-controls";
export function LeadTagsClient({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [items, setItems] = useState<ReferenceOption[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [version, setVersion] = useState(0); const [canAssign, setCanAssign] = useState(false); const [state, setState] = useState("loading"); const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let current = true;
    void Promise.all([fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/tags`, { cache: "no-store", credentials: "same-origin" }), loadReferences("TAG", undefined, false, leadId)]).then(async ([response, options]) => {
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { items: ReferenceOption[]; version: number; canAssign: boolean };
      if (current) { setItems([...new Map([...options, ...data.items].map((item) => [item.id, item])).values()]); setSelected(data.items.map((item) => item.id)); setVersion(data.version); setCanAssign(data.canAssign); setState("ready"); }
    }).catch(() => { if (current) setState("error"); });
    return (): void => { current = false; };
  }, [leadId, revision]);
  async function save(): Promise<void> {
    setState("loading"); setSaved(false);
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/tags`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ tagIds: selected, expectedVersion: version, idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) { setState(response.status === 409 ? "conflict" : "error"); return; }
      setSaved(true); setRevision((value) => value + 1);
    } catch { setState("error"); }
  }
  return <main><h1>Tags du lead</h1><Link href={`/leads/${encodeURIComponent(leadId)}`}>Retour à la fiche</Link><section className="panel reference-admin">
    {state === "loading" ? <p role="status">Chargement / enregistrement…</p> : null}
    {saved && state === "ready" ? <p role="status">Tags enregistrés. Timeline et audit mis à jour.</p> : null}
    {state === "error" || state === "conflict" ? <p role="alert">{state === "conflict" ? "Le lead a changé. Rechargez avant une nouvelle tentative." : "Accès refusé ou données indisponibles."}</p> : null}
    <button type="button" onClick={() => setRevision((value) => value + 1)}>Recharger les tags</button>
    <form action={save}><fieldset disabled={!canAssign || state === "loading"}><legend>Ajouter, retirer ou remplacer des tags</legend>{items.map((tag) => <label key={tag.id} className="reference-tag"><input type="checkbox" checked={selected.includes(tag.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, tag.id] : selected.filter((id) => id !== tag.id))} />{tag.label}{tag.state !== "ACTIVE" ? " — archivé, conservé dans l’historique" : ""}</label>)}{!items.length && state === "ready" ? <p>Aucun tag actif disponible.</p> : null}<button type="submit">Enregistrer les tags</button></fieldset></form>
    <p>La simple visibilité du lead ne permet pas de changer ses tags. Toute modification validée alimente la timeline et l’audit.</p>
  </section></main>;
}
