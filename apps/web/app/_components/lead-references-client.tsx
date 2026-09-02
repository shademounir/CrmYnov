"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LeadReferenceSelectors, referenceFormText } from "./reference-controls";
export function LeadReferencesClient({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [lead, setLead] = useState<{ campus: string; program: string; campaign: string; version: number } | null>(null);
  const [state, setState] = useState("loading");
  useEffect(() => {
    let current = true;
    void fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, { cache: "no-store", credentials: "same-origin" }).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as NonNullable<typeof lead>;
      if (current) { setLead(data); setState("ready"); }
    }).catch(() => { if (current) setState("error"); });
    return (): void => { current = false; };
  }, [leadId]);
  async function save(form: FormData): Promise<void> {
    if (!lead) return; setState("loading");
    const fields = Object.fromEntries(["campus", "program", "campaign"].map((key) => [key, referenceFormText(form, key)]));
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, expectedVersion: lead.version, idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) { setState("error"); return; }
      const data = await response.json() as NonNullable<typeof lead>; setLead(data); setState("success");
    } catch { setState("error"); }
  }
  return <main><h1>Référentiels du lead</h1><Link href={`/leads/${encodeURIComponent(leadId)}`}>Retour à la fiche</Link>
    <p>Une valeur historique inchangée est conservée. Toute nouvelle sélection doit être active et autorisée.</p>
    {state === "loading" ? <p role="status">Chargement / enregistrement…</p> : null}
    {state === "error" ? <p role="alert">Modification refusée. Vérifiez les valeurs actives, vos droits et rechargez en cas de conflit.</p> : null}
    {state === "success" ? <p role="status">Modification confirmée par l’API.</p> : null}
    {lead ? <form action={save}><LeadReferenceSelectors initial={lead} /><button type="submit" disabled={state === "loading"}>Enregistrer les référentiels</button></form> : null}
  </main>;
}
