"use client";

import { useEffect, useMemo, useState } from "react";

interface MappingColumn { sourceColumn: string; targetField?: string; action: string; required?: boolean; reason?: string }
interface MappingTemplate { id: string; mappingKey: string; name: string; profile: string; version: number; columns: MappingColumn[]; builtIn: boolean }
interface DryRunResult {
  total: number; valid: number; duplicates: number; manualReview: number; invalid: number; ignored: number;
  assigned: number; unassigned: number; mutated: false; lines: Array<{ lineNumber: number; outcome: string; reason?: string; proposedAssigneeId?: string }>;
}
interface PersistentResult { batchId: string; reportId: string; total: number; created: number; attached: number; manualReview: number; invalid: number; replayed: boolean }

const API = "/api/crm";

export default function ImportMappingPage(): React.JSX.Element {
  const [mappings, setMappings] = useState<MappingTemplate[]>([]);
  const [mappingKey, setMappingKey] = useState("forminator-zapier-v1");
  const [strategy, setStrategy] = useState("UNASSIGNED");
  const [targetUserId, setTargetUserId] = useState("");
  const [campus, setCampus] = useState("");
  const [campaign, setCampaign] = useState("");
  const [rowsText, setRowsText] = useState("[]");
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [persistent, setPersistent] = useState<PersistentResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(() => mappings.find((mapping) => mapping.mappingKey === mappingKey), [mappingKey, mappings]);

  useEffect(() => {
    void fetch(`${API}/lead-import/mappings`, { credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<MappingTemplate[]> : Promise.reject(new Error("mapping_load_failed")))
      .then(setMappings)
      .catch(() => setError("Les profils de mapping ne sont pas disponibles."));
  }, []);

  async function simulate(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setError(""); setResult(null); setPersistent(null); setConfirmed(false);
    if (!selected) { setError("Sélectionnez une version de mapping disponible."); return; }
    let rows: Array<Record<string, string>>;
    try {
      const parsed: unknown = JSON.parse(rowsText);
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("rows_invalid");
      rows = parsed as Array<Record<string, string>>;
    } catch { setError("L’aperçu local doit être un tableau JSON non vide."); return; }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${selected.id}:${rowsText}`));
    const idempotencyKey = `dry-run-${[...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const response = await fetch(`${API}/lead-import/dry-runs`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey,
        mappingKey: selected.mappingKey,
        mappingVersion: selected.version,
        sourceColumns: selected.columns.map((column) => column.sourceColumn),
        rows,
        context: {
          source: selected.profile === "LEGACY_CRM" ? "LEGACY_IMPORT" : "WEB_FORM",
          technicalSystem: selected.profile,
          originalSource: selected.profile,
          campus,
          campaign,
        },
        assignment: { strategy, ...(strategy === "FIXED" ? { targetUserId } : {}) },
      }),
    });
    if (!response.ok) { setError("Simulation refusée : vérifiez les colonnes, valeurs et référentiels."); return; }
    setResult(await response.json() as DryRunResult);
  }

  async function persist(): Promise<void> {
    setError(""); setPersistent(null);
    if (!selected || !result || !confirmed) { setError("La confirmation explicite du dry-run est obligatoire."); return; }
    let rows: Array<Record<string, string>>;
    try { rows = JSON.parse(rowsText) as Array<Record<string, string>>; } catch { setError("Aperçu structuré invalide."); return; }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${selected.id}:${rowsText}`));
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const response = await fetch(`${API}/lead-import/confirmations`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: `import-${hex.slice(0, 24)}`, confirmed: true, sourceFileSha256: hex, mappingKey: selected.mappingKey,
        mappingVersion: selected.version, sourceColumns: selected.columns.map((column) => column.sourceColumn), rows,
        context: { source: selected.profile === "LEGACY_CRM" ? "LEGACY_IMPORT" : "WEB_FORM", technicalSystem: selected.profile,
          originalSource: selected.profile, campus, campaign }, assignment: { strategy, ...(strategy === "FIXED" ? { targetUserId } : {}) } }),
    });
    if (!response.ok) { setError("Confirmation refusée sans écriture partielle. Consultez la file À vérifier."); return; }
    setPersistent(await response.json() as PersistentResult);
  }

  return <main>
    <h1>Mapping et simulation d’import</h1>
    <p>Le dry-run normalise, détecte les doublons et prévisualise l’affectation sans créer ni modifier de lead.</p>
    <p>La confirmation explicite du dry-run est obligatoire avant l’import dans PostgreSQL local.</p>
    <ol><li>Profil</li><li>Mapping versionné</li><li>Contexte</li><li>Affectation</li><li>Simulation</li><li>Confirmation séparée</li></ol>
    <form onSubmit={(event) => void simulate(event)}>
      <label>Profil de mapping <select value={mappingKey} onChange={(event) => setMappingKey(event.target.value)}>
        {mappings.map((mapping) => <option key={mapping.id} value={mapping.mappingKey}>{mapping.name} — v{mapping.version}</option>)}
      </select></label>
      <label>Stratégie d’affectation <select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
        <option value="UNASSIGNED">Non affecté</option><option value="FIXED">Affectataire fixe</option>
        <option value="ROUND_ROBIN">Round-robin</option><option value="CONTROLLED_RANDOM">Aléatoire contrôlé</option>
      </select></label>
      {strategy === "FIXED" ? <label>Identifiant de l’affectataire <input value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} required /></label> : null}
      <label>Campus <input value={campus} onChange={(event) => setCampus(event.target.value)} required /></label>
      <label>Campagne <input value={campaign} onChange={(event) => setCampaign(event.target.value)} required /></label>
      <label>Aperçu structuré non persisté, transmis uniquement à l’API locale <textarea aria-label="Aperçu structuré" value={rowsText} onChange={(event) => setRowsText(event.target.value)} rows={8} /></label>
      <button type="submit">Simuler sans importer</button>
    </form>
    {selected ? <section><h2>Colonnes couvertes</h2><ul>{selected.columns.map((column) => <li key={column.sourceColumn}>
      {column.sourceColumn} → {column.targetField ?? column.action}{column.required ? " (obligatoire)" : ""}
    </li>)}</ul></section> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result ? <section aria-live="polite"><h2>Résultat expurgé</h2>
      <p>Total {result.total} — valides {result.valid} — doublons {result.duplicates} — revue {result.manualReview} — invalides {result.invalid} — ignorées {result.ignored}</p>
      <p>Affectés {result.assigned} — non affectés {result.unassigned} — mutation : {result.mutated ? "oui" : "non"}</p>
      <ul>{result.lines.map((line) => <li key={line.lineNumber}>Ligne {line.lineNumber} : {line.outcome}{line.reason ? ` (${line.reason})` : ""}</li>)}</ul>
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Je confirme les compteurs, collisions et affectations affichés.</label>
      <button type="button" disabled={!confirmed} onClick={() => void persist()}>Importer dans PostgreSQL local</button>
    </section> : null}
    {persistent ? <section aria-live="polite"><h2>Import persistant confirmé</h2><p>Lot {persistent.batchId} — rapport {persistent.reportId}</p>
      <p>Créés {persistent.created} — provenances ajoutées {persistent.attached} — à vérifier {persistent.manualReview} — invalides {persistent.invalid}</p></section> : null}
  </main>;
}
