"use client";

import { useEffect, useState } from "react";

export interface ReferenceOption { id: string; kind: string; code: string; label: string; scope: string; campusId: string | null; state: string; version: number }
export const referenceLabels = { CAMPUS: "Campus", PROGRAM: "Formation", SCHOLARSHIP: "Bourse", CAMPAIGN: "Campagne", TAG: "Tag" } as const;
export type ReferenceKind = keyof typeof referenceLabels;
export function referenceFormText(form: FormData, key: string): string { const value = form.get(key); return typeof value === "string" ? value : ""; }

export async function loadReferences(kind: ReferenceKind, campusId?: string, includeArchived = false, leadId?: string): Promise<ReferenceOption[]> {
  const query = new URLSearchParams({ kind, includeArchived: String(includeArchived) });
  if (campusId) query.set("campusId", campusId);
  if (leadId) query.set("leadId", leadId);
  const response = await fetch(`/api/crm/references?${query}`, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("Référentiels indisponibles ou accès refusé.");
  const body = await response.json() as { items: ReferenceOption[] };
  if (!Array.isArray(body.items)) throw new Error("Réponse référentiel invalide.");
  return body.items;
}

export function ReferenceSelect({ name, label, options, value, disabled = false, onChange }: Readonly<{ name: string; label: string; options: ReferenceOption[]; value: string; disabled?: boolean; onChange: (value: string) => void }>): React.JSX.Element {
  const historical = Boolean(value) && !options.some((item) => item.code === value);
  return <label>{label}<select name={name} value={value} onChange={(event) => onChange(event.target.value)} required disabled={disabled} style={{ minHeight: 44 }}>
    <option value="">Sélectionner une valeur active</option>
    {historical ? <option value={value}>{value} — valeur historique conservée</option> : null}
    {options.map((item) => <option key={item.id} value={item.code}>{item.label}</option>)}
  </select></label>;
}

export function LeadReferenceSelectors({ initial = { campus: "", program: "", campaign: "" } }: Readonly<{ initial?: { campus: string; program: string; campaign: string } }>): React.JSX.Element {
  const [values, setValues] = useState(initial);
  const [campuses, setCampuses] = useState<ReferenceOption[]>([]);
  const [programs, setPrograms] = useState<ReferenceOption[]>([]);
  const [campaigns, setCampaigns] = useState<ReferenceOption[]>([]);
  const [state, setState] = useState("loading");
  useEffect(() => {
    let current = true;
    void loadReferences("CAMPUS").then((rows) => { if (current) { setCampuses(rows); setState("ready"); } }).catch(() => { if (current) setState("error"); });
    return (): void => { current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    const campus = campuses.find((item) => item.code === values.campus || item.label === values.campus);
    if (!campus) { setPrograms([]); setCampaigns([]); return (): void => { current = false; }; }
    setState("loading");
    void Promise.all([loadReferences("PROGRAM", campus.id), loadReferences("CAMPAIGN", campus.id)]).then(([program, campaign]) => {
      if (current) { setPrograms(program); setCampaigns(campaign); setState("ready"); }
    }).catch(() => { if (current) setState("error"); });
    return (): void => { current = false; };
  }, [campuses, values.campus]);
  return <fieldset className="reference-fields" aria-busy={state === "loading"}><legend>Référentiels gouvernés</legend>
    <ReferenceSelect name="campus" label="Campus" options={campuses} value={values.campus} disabled={state === "loading"} onChange={(campus) => setValues({ campus, program: "", campaign: "" })} />
    <ReferenceSelect name="program" label="Formation" options={programs} value={values.program} disabled={state !== "ready"} onChange={(program) => setValues({ ...values, program })} />
    <ReferenceSelect name="campaign" label="Campagne" options={campaigns} value={values.campaign} disabled={state !== "ready"} onChange={(campaign) => setValues({ ...values, campaign })} />
    {state === "loading" ? <p role="status">Chargement des valeurs autorisées…</p> : null}
    {state === "error" ? <p role="alert">Référentiels indisponibles. Ne validez pas le formulaire.</p> : null}
    {state === "ready" && !campuses.length ? <p>Aucun campus actif disponible. Contacter un administrateur.</p> : null}
  </fieldset>;
}
