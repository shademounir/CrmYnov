"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiString, resourceObjects, type ApiObject, type ApiValue } from "../../_components/connected-resource";
import { LeadReferenceSelectors, loadReferences, ReferenceSelect, referenceFormText, type ReferenceOption } from "../../_components/reference-controls";
import { sheetApiObject, sheetRequest } from "./sheets-client";

type Feedback = { kind: "neutral" | "loading" } | { kind: "success" | "error"; message: string };
const targets = ["firstName", "lastName", "email", "phone", "externalId", "educationLevel", "program", "campus", "campaign", "historicalStatus", "occurredAt"];
const actions = ["DIRECT", "TRIM", "LOWERCASE", "PHONE", "DATE", "METADATA", "IGNORE"];

export default function ScheduledSheetsPage(): React.JSX.Element {
  const [campuses, setCampuses] = useState<ReferenceOption[]>([]), [campus, setCampus] = useState("");
  const [connectors, setConnectors] = useState<ApiObject[]>([]), [selected, setSelected] = useState<ApiObject>({});
  const [mapping, setMapping] = useState<ApiObject>({}), [columns, setColumns] = useState<ApiObject[]>([]);
  const [runs, setRuns] = useState<ApiObject[]>([]), [feedback, setFeedback] = useState<Feedback>({ kind: "neutral" });
  const [historyPage, setHistoryPage] = useState(0);
  const [loaded, setLoaded] = useState(false), [refreshed, setRefreshed] = useState("");
  const revision = useRef(0);
  const busy = feedback.kind === "loading";
  const id = apiString(selected, "id");
  const configuration = sheetApiObject(selected.configuration), context = sheetApiObject(configuration.context);
  useEffect(() => {
    let active = true;
    void loadReferences("CAMPUS").then((items) => { if (active) setCampuses(items); })
      .catch(() => { if (active) setFeedback({ kind: "error", message: "Les campus autorisés sont indisponibles." }); });
    return (): void => { active = false; revision.current++; };
  }, []);

  async function perform(action: () => Promise<ApiValue>, success: string, apply: (value: ApiValue) => void): Promise<void> {
    const current = ++revision.current; setFeedback({ kind: "loading" });
    try {
      const value = await action();
      if (current !== revision.current) return;
      apply(value); setFeedback({ kind: "success", message: success }); setRefreshed(new Date().toLocaleTimeString("fr-FR"));
    } catch (error) {
      if (current === revision.current) setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Service indisponible. Aucune réussite n’a été confirmée." });
    }
  }
  function choose(row: ApiObject, fallback: ApiObject = mapping): void {
    setSelected(row); setRuns([]); setHistoryPage(0);
    const next = sheetApiObject(sheetApiObject(row.configuration).mapping);
    const template = Object.keys(next).length ? next : fallback;
    setMapping(template); setColumns(resourceObjects(template.columns ?? []));
  }
  async function refresh(): Promise<void> {
    await perform(() => sheetRequest(`?campus=${encodeURIComponent(campus)}`), "Configuration actualisée.", (value) => {
      const data = sheetApiObject(value), rows = resourceObjects(data.connectors ?? []);
      const template = resourceObjects(data.mappings ?? [])[0] ?? {};
      setConnectors(rows); setLoaded(true); choose(rows.find((row) => apiString(row, "id") === id) ?? rows[0] ?? {}, template);
    });
  }
  function changeColumn(index: number, key: string, value: ApiValue): void {
    setColumns((items) => items.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }
  async function save(form: FormData): Promise<void> {
    const enabled = form.get("enabled") === "on";
    const fields = { campus: referenceFormText(form, "campus"), program: referenceFormText(form, "program"), campaign: referenceFormText(form, "campaign") };
    const cleaned = columns.map((column) => {
      const { targetField, ...rest } = column;
      return ["METADATA", "IGNORE"].includes(apiString(column, "action")) ? { ...rest, reason: apiString(column, "reason", "explicit_mapping_choice") } : { ...column, targetField };
    });
    const body = { expectedVersion: Number(selected.version ?? 0), enabled, intervalMinutes: Number(referenceFormText(form, "interval")),
      workbookLink: referenceFormText(form, "workbook"), tab: referenceFormText(form, "tab"), campusId: fields.campus,
      mapping: { ...mapping, mappingKey: referenceFormText(form, "mappingKey"), name: referenceFormText(form, "mappingName"), columns: cleaned },
      context: { ...fields, source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", educationLevel: referenceFormText(form, "educationLevel") },
      assignment: { strategy: referenceFormText(form, "strategy"), ...(referenceFormText(form, "target") ? { targetUserId: referenceFormText(form, "target") } : {}) } };
    await perform(() => sheetRequest(id ? `/${encodeURIComponent(id)}` : "", id ? "PUT" : "POST", body), "Version enregistrée par l’API.", (value) => {
      const row = sheetApiObject(value); choose(row); setConnectors((items) => [...items.filter((item) => apiString(item, "id") !== apiString(row, "id")), row]);
    });
  }
  async function history(page = 1): Promise<void> {
    await perform(() => sheetRequest(`/${encodeURIComponent(id)}/runs?page=${page}`), "Historique actualisé.", (value) => { setRuns(resourceObjects(value)); setHistoryPage(page); });
  }
  return <main className="sheets-admin">
    <header><p className="eyebrow">Administration · Imports</p><h1>Google Sheets planifié</h1><p>Configurez, simulez et suivez une alimentation contrôlée.</p></header>
    <aside className="sheets-notice"><strong>Mode synthétique uniquement</strong><p>Aucun accès Google réel. Le connecteur est désactivé par défaut. Un seul canal automatique peut être actif ; les imports manuels restent disponibles.</p><Link href="/imports/wizard">Ouvrir l’import manuel</Link></aside>
    <section className="sheets-panel sheets-controls"><ReferenceSelect name="consultedCampus" label="Campus à consulter" options={campuses} value={campus} disabled={busy} onChange={(value) => { revision.current++; setCampus(value); setLoaded(false); setSelected({}); setConnectors([]); setRuns([]); setHistoryPage(0); setFeedback({ kind: "neutral" }); }} />
      <button type="button" disabled={!campus || busy} onClick={() => { void refresh(); }}>Charger / actualiser</button>
      {refreshed ? <small>Données actualisées à {refreshed}</small> : null}</section>
    <div aria-busy={busy}>{busy ? <p role="status">Traitement en cours…</p> : null}
      {feedback.kind === "error" ? <p role="alert" className="sheets-error">{feedback.message}</p> : null}
      {feedback.kind === "success" ? <p role="status" className="sheets-success">{feedback.message}</p> : null}</div>
    {loaded ? <>
      <nav aria-label="Configurations Sheets" className="sheets-controls">{connectors.map((row) => <button key={apiString(row, "id")} type="button" disabled={busy} aria-pressed={apiString(row, "id") === id} onClick={() => { choose(row); setFeedback({ kind: "neutral" }); }}>{apiString(row, "tab")} · v{apiString(row, "version")} · {row.enabled ? "Actif" : "Désactivé"}</button>)}
        <button type="button" disabled={busy} onClick={() => { choose({}); setFeedback({ kind: "neutral" }); }}>Nouvelle configuration</button></nav>
      {!connectors.length ? <p>Aucune configuration pour ce campus. Créez une première version désactivée.</p> : null}
      <form key={`${id}:${apiString(selected, "version")}`} action={save} className="sheets-panel">
        <h2>{id ? `Configuration · version ${apiString(selected, "version")}` : "Nouvelle configuration"}</h2>
        <fieldset disabled={busy} className="sheets-grid"><legend>Source contrôlée</legend>
          <label>Classeur synthétique<input name="workbook" type="url" required defaultValue={`https://docs.google.com/spreadsheets/d/${apiString(selected, "workbookId", "synthetic_crmy171")}/edit`} /></label>
          <label>Onglet<input name="tab" required maxLength={100} defaultValue={apiString(selected, "tab", "Synthétique")} /></label>
          <label>Intervalle (minutes)<input name="interval" type="number" min={5} max={15} required defaultValue={apiString(selected, "intervalMinutes", "15")} /></label>
          <label>Niveau par défaut<input name="educationLevel" required defaultValue={apiString(context, "educationLevel", "BAC")} /></label>
          <label>Clé du mapping<input name="mappingKey" required defaultValue={apiString(mapping, "mappingKey", "synthetic-sheet")} /></label>
          <label>Nom du mapping<input name="mappingName" required defaultValue={apiString(mapping, "name", "Mapping synthétique")} /></label>
        </fieldset>
        <LeadReferenceSelectors initial={{ campus: apiString(context, "campus", campus), program: apiString(context, "program"), campaign: apiString(context, "campaign") }} />
        <fieldset disabled={busy}><legend>Mapping versionné</legend><p>Un identifiant de soumission stable est obligatoire pour importer. Les lignes sans identifiant passent en revue.</p>
          <div className="sheets-mapping">{columns.map((column, index) => <article key={index} className="sheets-map-row">
            <label>Colonne source {index + 1}<input required value={apiString(column, "sourceColumn")} onChange={(event) => changeColumn(index, "sourceColumn", event.target.value)} /></label>
            <label>Champ CRM {index + 1}<select value={apiString(column, "targetField")} onChange={(event) => changeColumn(index, "targetField", event.target.value)}><option value="">Métadonnée / ignorée</option>{targets.map((target) => <option key={target}>{target}</option>)}</select></label>
            <label>Transformation {index + 1}<select value={apiString(column, "action")} onChange={(event) => changeColumn(index, "action", event.target.value)}>{actions.map((action) => <option key={action}>{action}</option>)}</select></label>
            <label className="sheets-check"><input type="checkbox" checked={column.required === true} onChange={(event) => changeColumn(index, "required", event.target.checked)} />Obligatoire</label>
          </article>)}</div>
        </fieldset>
        <fieldset disabled={busy} className="sheets-grid"><legend>Affectation et activation</legend>
          <label>Stratégie<select name="strategy" defaultValue={apiString(sheetApiObject(configuration.assignment), "strategy", "UNASSIGNED")}><option value="UNASSIGNED">Non affecté</option><option value="FIXED">Conseiller fixe</option><option value="ROUND_ROBIN">Round-robin</option><option value="CONTROLLED_RANDOM">Aléatoire contrôlé</option></select></label>
          <label>Conseiller fixe (identifiant autorisé)<input name="target" defaultValue={apiString(sheetApiObject(configuration.assignment), "targetUserId")} /></label>
          <label className="sheets-check"><input type="checkbox" name="enabled" defaultChecked={selected.enabled === true} />Activer le canal automatique synthétique</label>
        </fieldset>
        <button type="submit" disabled={busy || !columns.length}>Enregistrer une nouvelle version</button>
      </form>
      {id ? <section className="sheets-panel"><h2>Exécutions et supervision</h2><p>Le serveur exécute les imports sans navigateur ouvert. Une demande manuelle utilise le même moteur.</p>
        <div className="sheets-controls"><button type="button" disabled={busy} onClick={() => { void perform(() => sheetRequest(`/${encodeURIComponent(id)}/simulations`, "POST"), "Simulation terminée sans écriture Lead.", (value) => { const result = sheetApiObject(value); setHistoryPage(0); setRuns([{ id: "simulation", status: "SIMULATION", createdCount: 0, reviewCount: result.review ?? 0, duplicateCount: 0, ignoredCount: 0 }]); }); }}>Simuler</button>
          <button type="button" disabled={busy || selected.enabled !== true} onClick={() => { void perform(() => sheetRequest(`/${encodeURIComponent(id)}/runs`, "POST", { expectedVersion: Number(selected.version) }), "Demande enregistrée. Consultez l’historique pour le résultat de l’import.", () => undefined); }}>Lancer manuellement</button>
          <button type="button" disabled={busy} onClick={() => { void history(); }}>Actualiser l’historique</button></div>
        {!runs.length ? <p>Aucune exécution affichée. Actualisez l’historique.</p> : <div className="sheets-runs">{runs.map((run) => <article key={apiString(run, "id")}><h3>{apiString(run, "status")} · {apiString(run, "trigger")}</h3><p>Mapping v{apiString(run, "configurationVersion", "—")} · {apiString(run, "startedAt", "Simulation")}</p><dl>{[["createdCount", "Créés"], ["duplicateCount", "Doublons"], ["reviewCount", "À revoir"], ["ignoredCount", "Ignorés"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{apiString(run, key ?? "", "0")}</dd></div>)}</dl>{run.errorCode ? <p className="sheets-error">Exécution interrompue : {apiString(run, "errorCode")}. Vérifiez les droits, la source et la configuration avant de relancer.</p> : null}</article>)}</div>}
        {historyPage > 0 ? <nav aria-label="Pagination de l’historique" className="sheets-controls">
          <button type="button" disabled={busy || historyPage === 1} onClick={() => { void history(historyPage - 1); }}>Exécutions précédentes</button>
          <span>Page {historyPage} · 50 exécutions maximum</span>
          <button type="button" disabled={busy || runs.length < 50 || historyPage >= 10_000} onClick={() => { void history(historyPage + 1); }}>Exécutions suivantes</button>
        </nav> : null}
      </section> : null}
    </> : null}
  </main>;
}
