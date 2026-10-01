"use client";

import { useEffect, useRef, useState } from "react";
import { loadReferences, ReferenceSelect, type ReferenceOption } from "../../_components/reference-controls";
import { type ApiObject, apiString, resourceObjects } from "../../_components/connected-resource";
import { sheetApiObject, sheetApiValue } from "../scheduled-sheets/sheets-client";

async function configuration(campus: string, body?: object): Promise<ApiObject> {
  const response = await fetch(`/api/crm/assignment/config${body ? "" : `?campusId=${encodeURIComponent(campus)}`}`, {
    method: body ? "PUT" : "GET", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(response.status === 409 ? "Conflit de version. Rechargez la configuration." : "Configuration indisponible ou accès refusé. Aucune réussite confirmée.");
  const value = sheetApiObject(sheetApiValue(await response.json()));
  if (typeof value.version !== "number" || typeof value.automaticEnabled !== "boolean" || !Array.isArray(value.rules)) throw new Error("Configuration invalide. Aucune réussite confirmée.");
  return value;
}

export function AutomationControl(): React.JSX.Element {
  const [campuses, setCampuses] = useState<ReferenceOption[]>([]), [campus, setCampus] = useState("");
  const [snapshot, setSnapshot] = useState<ApiObject | null>(null), [enabled, setEnabled] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "idle" | "loading" | "success" | "error"; message: string }>({ kind: "idle", message: "" });
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    void loadReferences("CAMPUS").then((rows) => { if (active) setCampuses(rows); }).catch(() => { if (active) setFeedback({ kind: "error", message: "Campus autorisés indisponibles." }); });
    return (): void => { active = false; revision.current++; };
  }, []);
  async function perform(value: string, save = false): Promise<void> {
    const current = ++revision.current;
    setFeedback({ kind: "loading", message: "Chargement…" });
    if (!save) setSnapshot(null);
    try {
      const data = await configuration(value, save && snapshot ? { campusId: value, expectedVersion: snapshot.version, rules: snapshot.rules, automaticEnabled: enabled } : undefined);
      if (current !== revision.current) return;
      setSnapshot(data); setEnabled(data.automaticEnabled === true);
      setFeedback({ kind: "success", message: save ? "Activation d’affectation enregistrée pour ce campus." : "Configuration actualisée." });
    } catch (error) { if (current === revision.current) setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Service indisponible." }); }
  }
  const busy = feedback.kind === "loading";
  return <section aria-label="Automatisation par campus" aria-busy={busy}>
    <ReferenceSelect name="assignment-campus" label="Campus" options={campuses} value={campus} disabled={busy} onChange={(value) => { setCampus(value); if (value) void perform(value); else { revision.current++; setSnapshot(null); setFeedback({ kind: "idle", message: "" }); } }} />
    <p>L’activation du connecteur Sheets reste indépendante. Cette option contrôle l’affectation automatique des imports ; elle ne bloque pas les affectations manuelles autorisées.</p>
    {snapshot ? <form onSubmit={(event) => { event.preventDefault(); void perform(campus, true); }}>
      <p>Configuration enregistrée : version {typeof snapshot.version === "number" ? snapshot.version : "indisponible"}</p>
      <label style={{ display: "flex", alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => { setEnabled(event.target.checked); setFeedback({ kind: "idle", message: "" }); }} />Activer l’affectation automatique</label>
      <ul>{resourceObjects(snapshot.rules ?? []).map((rule, index) => <li key={index}>{apiString(rule, "scope")} — {apiString(rule, "strategy")} — {rule.enabled ? "Règle active" : "Règle inactive"}</li>)}</ul>
      <p>Priorité : Campagne → Source → repli du campus → UNASSIGNED. Les règles et destinataires existants sont conservés.</p>
      <button type="submit" disabled={busy} style={{ minHeight: 44 }}>Enregistrer la configuration</button>
    </form> : null}
    <button type="button" disabled={busy || !campus} onClick={() => { void perform(campus); }} style={{ minHeight: 44 }}>Actualiser</button>
    {feedback.kind === "error" ? <p role="alert">{feedback.message}</p> : feedback.message ? <p role="status">{feedback.message}</p> : null}
  </section>;
}
