"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiString, resourceObjects, type ApiObject, type ApiValue } from "../../_components/connected-resource";
import { LeadReferenceSelectors, loadReferences, ReferenceSelect, referenceFormText, type ReferenceOption } from "../../_components/reference-controls";
import { sheetApiObject, sheetRequest, sheetSourceConfiguration, sheetSimulation, type SheetSimulation } from "./sheets-client";

type Feedback = { kind: "neutral" } | { kind: "loading" | "success" | "error"; message: string };
type FeedbackArea = "overview" | "configuration" | "execution";
const targets = ["firstName", "lastName", "email", "phone", "externalId", "educationLevel", "program", "campus", "campaign", "historicalStatus", "occurredAt"];
const actions = ["DIRECT", "TRIM", "LOWERCASE", "PHONE", "DATE", "METADATA", "IGNORE"];
const fieldLabels: Record<string, string> = { firstName: "Prénom", lastName: "Nom", email: "Email", phone: "Téléphone", externalId: "Identifiant de soumission", educationLevel: "Niveau d’études", program: "Formation", campus: "Campus", campaign: "Campagne", historicalStatus: "Statut d’origine", occurredAt: "Date de soumission" };
const actionLabels: Record<string, string> = { DIRECT: "Conserver la valeur", TRIM: "Retirer les espaces superflus", LOWERCASE: "Convertir en minuscules", PHONE: "Normaliser le téléphone", DATE: "Lire la date", METADATA: "Information complémentaire", IGNORE: "Ne pas importer" };
const runLabels: Record<string, string> = { COMPLETED: "Terminé", RUNNING: "En cours", PENDING: "En attente", QUEUED: "En attente", FAILED: "Échec", CANCELLED: "Annulé", INTERRUPTED: "Interrompu", SIMULATION: "Simulation", SCHEDULED: "Planifié", MANUAL: "À la demande" };
const sourceLabels: Record<string, string> = { WEB_FORM: "Formulaire web", PHONE_CALL: "Appel téléphonique", PHYSICAL_VISIT: "Visite sur place", WEBSITE: "Site web", EVENT: "Événement", PARTNER: "Partenaire", JOBINTECH: "JobInTech", LEGACY_IMPORT: "Reprise historique", MANUAL_ENTRY: "Saisie manuelle", OTHER_CONTROLLED: "Autre source contrôlée" };
function RunHeading({ run }: { run: ApiObject }): React.JSX.Element {
  return <h3>{runLabels[apiString(run, "status")] ?? "État indisponible"} · {runLabels[apiString(run, "trigger")] ?? "Mode non renseigné"}</h3>;
}
function ConfirmedState({ selected }: { selected: ApiObject }): React.JSX.Element {
  if (!apiString(selected, "id")) return <p className="sheets-persisted-state">Configuration non enregistrée</p>;
  return <p className="sheets-persisted-state">État enregistré : <strong>{selected.enabled === true ? "Imports automatiques actifs" : "Imports automatiques désactivés"}</strong> · version {apiString(selected, "version")}</p>;
}

function ExecutionFeedback({ feedback }: { feedback: Feedback }): React.JSX.Element {
  const busy = feedback.kind === "loading";
  return <div className="sheets-feedback" aria-busy={busy}>{busy ? <p role="status">{feedback.message}</p> : null}
    {feedback.kind === "error" ? <p role="alert" className="sheets-error">{feedback.message}</p> : null}
    {feedback.kind === "success" ? <p role="status" className="sheets-success">{feedback.message}</p> : null}</div>;
}

function simulationFeedback(value: ApiValue): Feedback {
  const result = sheetSimulation(value);
  if (result.reconciliationRequired === true) return { kind: "error", message: "Simulation bloquée : le classeur a changé ou nécessite une réconciliation. Aucune ligne ne peut être importée ; aucun prospect n’a été créé." };
  if (result.review > 0) return { kind: "success", message: `Simulation terminée sans création de prospect. ${result.review} ligne(s) à vérifier avant l’import.` };
  return { kind: "success", message: "Simulation terminée sans création de prospect." };
}

function SimulationSummary({ result, version }: { result: SheetSimulation; version: string }): React.JSX.Element {
  return <article className="sheets-simulation" aria-label="Résultat de simulation"><h3>Simulation · {result.simulated ? "Données simulées" : "Lecture Google réelle"}</h3>
    <p>Version simulée : {version} · dernière configuration sauvegardée</p>
    <dl>{[["Lignes lues", result.rows], ["Lignes admissibles", result.mapped], ["À vérifier", result.review]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    {result.rows === 0 ? <p>Aucune ligne dans la plage lue.</p> : null}
    <p>Aucun prospect créé. Les doublons et l’affectation seront contrôlés lors de l’import ; cette simulation ne les prédit pas.</p>
  </article>;
}

export default function ScheduledSheetsPage(): React.JSX.Element {
  const [campuses, setCampuses] = useState<ReferenceOption[]>([]), [campus, setCampus] = useState("");
  const [connectors, setConnectors] = useState<ApiObject[]>([]), [selected, setSelected] = useState<ApiObject>({});
  const [mapping, setMapping] = useState<ApiObject>({}), [columns, setColumns] = useState<ApiObject[]>([]);
  const [runs, setRuns] = useState<ApiObject[]>([]), [feedback, setFeedback] = useState<Feedback>({ kind: "neutral" });
  const [historyPage, setHistoryPage] = useState(0);
  const [simulation, setSimulation] = useState<{ result: SheetSimulation; version: string } | null>(null);
  const [sourceMode, setSourceMode] = useState("SIMULATED"), [identityMode, setIdentityMode] = useState("EXTERNAL_ID");
  const [googleReady, setGoogleReady] = useState(false);
  const [reconciliation, setReconciliation] = useState<ApiObject | null>(null);
  const [loaded, setLoaded] = useState(false), [refreshed, setRefreshed] = useState("");
  const revision = useRef(0);
  const activeRequest = useRef<number | null>(null);
  const focusBeforeRequest = useRef<HTMLElement | null>(null);
  const [feedbackArea, setFeedbackArea] = useState<FeedbackArea>("overview");
  const busy = feedback.kind === "loading";
  const id = apiString(selected, "id");
  const configuration = sheetApiObject(selected.configuration), context = sheetApiObject(configuration.context);
  const source = sheetApiObject(configuration.source);
  const realUnavailable = sourceMode === "GOOGLE" && !googleReady;
  const savedRealUnavailable = source.mode === "GOOGLE" && !googleReady;
  const phoneMappingLimited = sourceMode === "GOOGLE" && columns.some((column) => {
    const reason = apiString(column, "reason");
    return reason === "ambiguous_numeric_phone_without_country_prefix" || reason === "duplicate_phone_source_not_selected";
  });
  useEffect(() => {
    if (busy || !focusBeforeRequest.current) return;
    const previous = focusBeforeRequest.current; focusBeforeRequest.current = null;
    if (previous.isConnected) previous.focus();
    else document.querySelector<HTMLButtonElement>(".sheets-save-bar button")?.focus();
  }, [busy]);
  useEffect(() => {
    let active = true;
    void loadReferences("CAMPUS").then((items) => { if (active) setCampuses(items); })
      .catch(() => { if (active) setFeedback({ kind: "error", message: "Les campus autorisés sont indisponibles." }); });
    return (): void => { active = false; revision.current++; };
  }, []);

  async function perform(action: () => Promise<ApiValue>, success: string | ((value: ApiValue) => Feedback), apply: (value: ApiValue) => void,
    area: FeedbackArea = "execution", loading = "Traitement en cours…"): Promise<void> {
    if (activeRequest.current !== null) return;
    if (document.activeElement instanceof HTMLElement) focusBeforeRequest.current = document.activeElement;
    const current = ++revision.current; activeRequest.current = current;
    setSimulation(null); setFeedbackArea(area); setFeedback({ kind: "loading", message: loading });
    try {
      const value = await action();
      if (current !== revision.current) return;
      apply(value); setFeedback(typeof success === "string" ? { kind: "success", message: success } : success(value)); setRefreshed(new Date().toLocaleTimeString("fr-FR"));
    } catch (error) {
      if (current === revision.current) setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Service indisponible. Aucune réussite n’a été confirmée." });
    } finally {
      if (activeRequest.current === current) activeRequest.current = null;
    }
  }
  function choose(row: ApiObject, fallback: ApiObject = mapping): void {
    setSelected(row); setRuns([]); setHistoryPage(0); setReconciliation(null); setSimulation(null);
    const nextSource = sheetApiObject(sheetApiObject(row.configuration).source);
    setSourceMode(apiString(nextSource, "mode", "SIMULATED")); setIdentityMode(apiString(nextSource, "identityMode", "EXTERNAL_ID"));
    const next = sheetApiObject(sheetApiObject(row.configuration).mapping);
    const template = Object.keys(next).length ? next : fallback;
    setMapping(template); setColumns(resourceObjects(template.columns ?? []));
  }
  async function refresh(): Promise<void> {
    await perform(() => sheetRequest(`?campus=${encodeURIComponent(campus)}`), "Configuration actualisée.", (value) => {
      const data = sheetApiObject(value), rows = resourceObjects(data.connectors ?? []);
      setGoogleReady(data.googleReady === true);
      const template = resourceObjects(data.mappings ?? [])[0] ?? {};
      setConnectors(rows); setLoaded(true); choose(rows.find((row) => apiString(row, "id") === id) ?? rows[0] ?? {}, template);
    }, "overview", "Actualisation en cours…");
  }
  function changeColumn(index: number, key: string, value: ApiValue): void {
    setColumns((items) => items.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }
  async function save(form: FormData): Promise<void> {
    const sourceConfiguration = sheetSourceConfiguration(form);
    const localRows = sourceConfiguration.identityMode === "LOCAL_ROW";
    const enabled = form.get("enabled") === "on";
    const fields = { campus: referenceFormText(form, "campus"), program: referenceFormText(form, "program"), campaign: referenceFormText(form, "campaign") };
    const cleaned = columns.map((column) => {
      const { targetField, ...rest } = column;
      return ["METADATA", "IGNORE"].includes(apiString(column, "action")) ? { ...rest, reason: apiString(column, "reason", "explicit_mapping_choice") } : { ...column, targetField };
    });
    const body = { expectedVersion: Number(selected.version ?? 0), enabled, intervalMinutes: Number(referenceFormText(form, "interval")),
      workbookLink: referenceFormText(form, "workbook"), tab: referenceFormText(form, "tab"), campusId: fields.campus,
      source: sourceConfiguration,
      mapping: { ...mapping, profile: localRows ? "CUSTOM" : "FORMINATOR_ZAPIER", mappingKey: referenceFormText(form, "mappingKey"), name: referenceFormText(form, "mappingName"), columns: cleaned },
      context: { ...fields, source: localRows ? referenceFormText(form, "businessSource") : "WEB_FORM", technicalSystem: localRows ? "GOOGLE_SHEETS_LOCAL" : "FORMINATOR_ZAPIER", ...(localRows ? { originalSource: referenceFormText(form, "originalSource") } : {}), educationLevel: referenceFormText(form, "educationLevel") },
      assignment: { strategy: referenceFormText(form, "strategy"), ...(referenceFormText(form, "target") ? { targetUserId: referenceFormText(form, "target") } : {}) } };
    await perform(() => sheetRequest(id ? `/${encodeURIComponent(id)}` : "", id ? "PUT" : "POST", body),
      `Configuration enregistrée. Import automatique ${enabled ? "actif" : "désactivé"}.`, (value) => {
      const row = sheetApiObject(value); choose(row); setConnectors((items) => [...items.filter((item) => apiString(item, "id") !== apiString(row, "id")), row]);
    }, "configuration", "Enregistrement en cours…");
  }
  async function history(page = 1): Promise<void> {
    await perform(() => sheetRequest(`/${encodeURIComponent(id)}/runs?page=${page}`), "Historique actualisé.", (value) => { setRuns(resourceObjects(value)); setHistoryPage(page); });
  }
  async function readReconciliation(page = 1): Promise<void> {
    setReconciliation(null);
    await perform(() => sheetRequest(`/${encodeURIComponent(id)}/reconciliation?page=${page}`), "Suivi local actualisé.", (value) => setReconciliation(sheetApiObject(value)));
  }
  return <main className="sheets-admin">
    <header><p className="eyebrow">Administration · Imports</p><h1>Google Sheets planifié</h1><p>Configurez, simulez et suivez une alimentation contrôlée.</p></header>
    <aside className={`sheets-notice sheets-source-notice ${sourceMode === "GOOGLE" ? "is-real" : "is-simulated"}`}>
      <div className="sheets-notice-heading"><span className="sheets-mode-pill">{sourceMode === "GOOGLE" ? "Mode réel" : "Mode simulé"}</span><strong>{sourceMode === "GOOGLE" ? "Lecture Google réelle — accès limité" : "Source simulée — aucun accès Google"}</strong></div>
      <p>Le connecteur est désactivé par défaut. Un seul canal automatique peut être actif. Le mode réel ne remplace jamais une erreur Google par des données simulées.</p><Link href="/imports/wizard">Ouvrir l’import manuel</Link>
    </aside>
    <section className="sheets-panel sheets-controls"><ReferenceSelect name="consultedCampus" label="Campus à consulter" options={campuses} value={campus} disabled={busy} onChange={(value) => { revision.current++; setCampus(value); setLoaded(false); setSelected({}); setConnectors([]); setRuns([]); setHistoryPage(0); setFeedback({ kind: "neutral" }); }} />
      <button type="button" disabled={!campus || busy} onClick={() => { void refresh(); }}>Charger / actualiser</button>
      {refreshed ? <small>Données actualisées à {refreshed}</small> : null}</section>
    {feedbackArea === "overview" ? <ExecutionFeedback feedback={feedback} /> : null}
    {loaded ? <>
      <nav aria-label="Configurations Sheets" className="sheets-controls">{connectors.map((row) => <button key={apiString(row, "id")} type="button" disabled={busy} aria-pressed={apiString(row, "id") === id} onClick={() => { choose(row); setFeedback({ kind: "neutral" }); }}>{apiString(row, "tab")} · v{apiString(row, "version")} · {row.enabled ? "Actif" : "Désactivé"}</button>)}
        <button type="button" disabled={busy} onClick={() => { choose({}); setFeedback({ kind: "neutral" }); }}>Nouvelle configuration</button></nav>
      {!connectors.length ? <p>Aucune configuration pour ce campus. Créez une première version désactivée.</p> : null}
      <form key={`${id}:${apiString(selected, "version")}`} onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget)); }} className="sheets-panel sheets-configuration" aria-busy={busy}>
        <h2>{id ? `Configuration · version ${apiString(selected, "version")}` : "Nouvelle configuration"}</h2>
        <p className="sheets-section-intro">Reliez les colonnes du classeur aux informations de vos prospects, puis vérifiez le résultat avant d’activer les imports.</p>
        <nav className="sheets-step-nav" aria-label="Étapes de configuration">
          <a href="#sheets-source">1. Connexion</a><a href="#sheets-scope">2. Périmètre</a><a href="#sheets-mapping">3. Correspondance</a><a href="#sheets-schedule">4. Planification</a>
        </nav>
        <fieldset id="sheets-source" disabled={busy} className="sheets-grid"><legend>1 · Connexion au classeur</legend>
          <label>Source<select name="sourceMode" value={sourceMode} onChange={(event) => setSourceMode(event.target.value)}><option value="SIMULATED">Données simulées</option><option value="GOOGLE">Google Sheets en lecture seule</option></select></label>
          <label>Classeur<input name="workbook" type="url" required defaultValue={`https://docs.google.com/spreadsheets/d/${apiString(selected, "workbookId", "synthetic_crmy171")}/edit`} /></label>
          <label>Onglet<input name="tab" required maxLength={100} defaultValue={apiString(selected, "tab", "Synthétique")} /></label>
          <label>Numéro de l’onglet (gid)<input name="sheetId" type="number" min={0} step={1} required defaultValue={apiString(source, "sheetId", "0")} /></label>
          <label>Plage autorisée, en-têtes inclus<input name="range" required defaultValue={apiString(source, "range", "A1:CW10002")} /><small>La sélection doit correspondre exactement à la source autorisée côté serveur. Aucune extension automatique.</small></label>
          <div className="sheets-source-state"><span className="sheets-state-label">Accès à la source</span><strong>{sourceMode === "GOOGLE" ? (googleReady ? "Google Sheets prêt en lecture seule" : "Configuration serveur requise") : "Données de démonstration locales"}</strong><span>{sourceMode === "GOOGLE" ? "L’activation du connecteur reste une action distincte." : "Aucun appel à Google n’est effectué."}</span></div>
          {realUnavailable ? <p className="sheets-inline-warning">Accès Google non configuré côté serveur. Enregistrement désactivé possible ; lecture et activation indisponibles. Aucun credential à saisir ici.</p> : null}
        </fieldset>
        <fieldset id="sheets-scope" disabled={busy} className="sheets-reference-section"><legend>2 · Campus et périmètre des prospects</legend>
          <LeadReferenceSelectors initial={{ campus: apiString(context, "campus", campus), program: apiString(context, "program"), campaign: apiString(context, "campaign") }} />
          <label>Niveau par défaut<input name="educationLevel" required defaultValue={apiString(context, "educationLevel", "BAC")} /></label>
        </fieldset>
        <fieldset id="sheets-mapping" disabled={busy}><legend>3 · Correspondance des colonnes</legend>
          <label>Identification des soumissions<select name="identityMode" value={identityMode} onChange={(event) => setIdentityMode(event.target.value)}><option value="EXTERNAL_ID">Identifiant de soumission fourni par la source</option><option value="LOCAL_ROW">Suivi local des lignes sans identifiant source</option></select></label>
          {identityMode === "LOCAL_ROW" ? <label>Canal d’origine<select name="businessSource" defaultValue={apiString(context, "source", "OTHER_CONTROLLED")}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
          {identityMode === "LOCAL_ROW" ? <><p>Le suivi local conserve les positions et détecte les changements observables. Une modification ou réorganisation peut suspendre l’import pour vérification. Ce mode ne crée aucun identifiant dans le classeur.</p><label>Origine déclarée des soumissions<input name="originalSource" required maxLength={120} defaultValue={apiString(context, "originalSource")} /><small>Indiquez l’origine connue ou explicitement non déterminée. Aucune origine Forminator n’est déduite.</small></label></> : <p>Chaque soumission doit avoir un identifiant stable. Les lignes sans identifiant seront à vérifier, sans création automatique.</p>}
          <div className="sheets-grid">
          <label>Référence de la correspondance<input name="mappingKey" required defaultValue={apiString(mapping, "mappingKey", "synthetic-sheet")} /></label>
          <label>Nom de la correspondance<input name="mappingName" required defaultValue={apiString(mapping, "name", "Mapping synthétique")} /></label>
          </div>
          {phoneMappingLimited ? <aside className="sheets-mapping-note" role="note"><strong>Téléphone non importé pour cette source</strong><p>Les colonnes téléphoniques restent des informations complémentaires : leur format ne permet pas une normalisation fiable sans inventer un préfixe ou modifier le numéro.</p></aside> : null}
          <div className="sheets-mapping">{columns.map((column, index) => <article key={index} className="sheets-map-row">
            <label>Colonne source {index + 1}<input required value={apiString(column, "sourceColumn")} onChange={(event) => changeColumn(index, "sourceColumn", event.target.value)} /></label>
            <label>Information du prospect {index + 1}<select value={apiString(column, "targetField")} onChange={(event) => changeColumn(index, "targetField", event.target.value)}><option value="">Information complémentaire / ignorée</option>{targets.map((target) => <option key={target} value={target}>{fieldLabels[target]}</option>)}</select></label>
            <label>Traitement de la valeur {index + 1}<select value={apiString(column, "action")} onChange={(event) => changeColumn(index, "action", event.target.value)}>{actions.map((action) => <option key={action} value={action}>{actionLabels[action]}</option>)}</select></label>
            <label className="sheets-check"><input type="checkbox" checked={column.required === true} onChange={(event) => changeColumn(index, "required", event.target.checked)} />Obligatoire</label>
          </article>)}</div>
        </fieldset>
        <fieldset id="sheets-schedule" disabled={busy} className="sheets-grid"><legend>4 · Planification et affectation</legend>
          <label>Intervalle entre les imports (minutes)<input name="interval" type="number" min={5} max={15} required defaultValue={apiString(selected, "intervalMinutes", "15")} /><small>De 5 à 15 minutes, même lorsque le navigateur est fermé.</small></label>
          <label>Mode d’affectation<select name="strategy" defaultValue={apiString(sheetApiObject(configuration.assignment), "strategy", "UNASSIGNED")}><option value="UNASSIGNED">Non affecté</option><option value="FIXED">Conseiller fixe</option><option value="ROUND_ROBIN">À tour de rôle</option><option value="CONTROLLED_RANDOM">Aléatoire contrôlé</option></select></label>
          <label>Conseiller fixe (identifiant autorisé)<input name="target" defaultValue={apiString(sheetApiObject(configuration.assignment), "targetUserId")} /></label>
          <label className="sheets-check"><input type="checkbox" name="enabled" disabled={realUnavailable} defaultChecked={selected.enabled === true} />Activer les imports automatiques</label>
          <p className="sheets-section-intro">L’activation des imports ne remplace pas les règles d’affectation automatique du campus. Une configuration enregistrée peut rester désactivée.</p>
        </fieldset>
        <div className="sheets-save-bar">
          <div><strong>5 · Enregistrement et état</strong><p>La nouvelle version sera utilisée pour les prochains imports.</p><ConfirmedState selected={selected} /></div>
          <button className="sheets-button-primary" type="submit" disabled={busy || !columns.length}>{busy && feedbackArea === "configuration" ? "Enregistrement…" : "Enregistrer une nouvelle version"}</button>
          {feedbackArea === "configuration" ? <ExecutionFeedback feedback={feedback} /> : null}
        </div>
      </form>
      {id ? <section className="sheets-panel sheets-execution-panel"><div className="sheets-section-heading"><div><h2>6 · Suivi des imports</h2><p>Vérifiez les résultats des imports planifiés ou lancés à la demande.</p></div><span className={`sheets-connector-pill ${selected.enabled === true ? "is-active" : "is-inactive"}`}>{selected.enabled === true ? "Connecteur actif" : "Connecteur désactivé"}</span></div>
        <div className="sheets-action-toolbar" aria-label="Actions d’import"><div><strong>Vérifier sans écrire</strong><button className="sheets-button-primary" type="button" disabled={busy || savedRealUnavailable} onClick={() => { const version = apiString(selected, "version"); void perform(() => sheetRequest(`/${encodeURIComponent(id)}/simulations`, "POST"), simulationFeedback, (value) => { setSimulation({ result: sheetSimulation(value), version }); }); }}>Simuler</button></div>
          <div><strong>Exécuter à la demande</strong><button type="button" disabled={busy || savedRealUnavailable || (selected.enabled !== true && source.identityMode !== "LOCAL_ROW")} onClick={() => { void perform(() => sheetRequest(`/${encodeURIComponent(id)}/runs`, "POST", { expectedVersion: Number(selected.version) }), "Demande enregistrée. Consultez l’historique pour le résultat de l’import.", () => undefined); }}>Lancer manuellement</button></div>
          <div><strong>Consulter les résultats</strong><button type="button" disabled={busy} onClick={() => { void history(); }}>Actualiser l’historique</button></div></div>
        {source.identityMode === "LOCAL_ROW" ? <p>Le lancement manuel importe uniquement le lot autorisé. Il n’active pas les prochains imports automatiques.</p> : null}
        {source.identityMode === "LOCAL_ROW" ? <><button type="button" disabled={busy} onClick={() => { void readReconciliation(); }}>Consulter les lignes à vérifier</button>
          {reconciliation ? <section aria-label="Réconciliation des lignes"><h3>{reconciliation.suspended === true ? "Import suspendu — vérification nécessaire" : "Suivi local des lignes"}</h3><p>Aucune résolution automatique. Les coordonnées des prospects ne sont pas affichées dans ce suivi.</p>
            {!resourceObjects(reconciliation.rows ?? []).length ? <p>Aucune ligne suivie.</p> : <ul>{resourceObjects(reconciliation.rows ?? []).map((row) => <li key={apiString(row, "rowNumber")}>Ligne {apiString(row, "rowNumber")} · {row.errorCode ? "À vérifier" : "Suivie"} · Dernière observation : {apiString(row, "lastObservedAt", "Non disponible")}</li>)}</ul>}
            <nav aria-label="Pagination des lignes suivies" className="sheets-controls"><button type="button" disabled={busy || Number(reconciliation.page ?? 1) <= 1} onClick={() => { void readReconciliation(Number(reconciliation.page) - 1); }}>Lignes précédentes</button><span>Page {apiString(reconciliation, "page", "1")} · 50 lignes maximum</span><button type="button" disabled={busy || resourceObjects(reconciliation.rows ?? []).length < 50 || Number(reconciliation.page ?? 1) >= 10000} onClick={() => { void readReconciliation(Number(reconciliation.page ?? 1) + 1); }}>Lignes suivantes</button></nav>
          </section> : null}</> : null}
        {feedbackArea === "execution" ? <ExecutionFeedback feedback={feedback} /> : null}
        {simulation ? <SimulationSummary {...simulation} /> : null}
        {!runs.length ? <p>Aucune exécution affichée. Actualisez l’historique.</p> : <div className="sheets-runs">{runs.map((run) => <article key={apiString(run, "id")}><RunHeading run={run} /><p>Configuration v{apiString(run, "configurationVersion", "—")} · {apiString(run, "startedAt", "Simulation")}</p><dl>{[["createdCount", "Créés"], ["duplicateCount", "Doublons"], ["reviewCount", "À revoir"], ["ignoredCount", "Ignorés"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{apiString(run, key ?? "", "0")}</dd></div>)}</dl>{run.errorCode ? <p className="sheets-error">Import interrompu. Vérifiez vos droits, le classeur et la configuration avant de relancer.</p> : null}</article>)}</div>}
        {historyPage > 0 ? <nav aria-label="Pagination de l’historique" className="sheets-controls">
          <button type="button" disabled={busy || historyPage === 1} onClick={() => { void history(historyPage - 1); }}>Exécutions précédentes</button>
          <span>Page {historyPage} · 50 exécutions maximum</span>
          <button type="button" disabled={busy || runs.length < 50 || historyPage >= 10_000} onClick={() => { void history(historyPage + 1); }}>Exécutions suivantes</button>
        </nav> : null}
      </section> : null}
    </> : null}
  </main>;
}
