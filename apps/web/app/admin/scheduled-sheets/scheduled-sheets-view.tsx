import Link from "next/link";
import React from "react";
import { apiString, resourceObjects, type ApiObject, type ApiValue } from "../../_components/connected-resource";
import { LeadReferenceSelectors, ReferenceSelect, type ReferenceOption } from "../../_components/reference-controls";
import { sheetApiObject, type SheetSimulation } from "./sheets-client";

export type Feedback = { kind: "neutral" } | { kind: "loading" | "success" | "error"; message: string };
export type FeedbackArea = "overview" | "configuration" | "execution";

interface ScheduledSheetsModel {
  campuses: ReferenceOption[];
  campus: string;
  connectors: ApiObject[];
  selected: ApiObject;
  mapping: ApiObject;
  columns: ApiObject[];
  runs: ApiObject[];
  feedback: Feedback;
  feedbackArea: FeedbackArea;
  historyPage: number;
  simulation: { result: SheetSimulation; version: string } | null;
  sourceMode: string;
  identityMode: string;
  googleReady: boolean;
  reconciliation: ApiObject | null;
  loaded: boolean;
  refreshed: string;
  busy: boolean;
  id: string;
  configuration: ApiObject;
  context: ApiObject;
  source: ApiObject;
  realUnavailable: boolean;
  savedRealUnavailable: boolean;
  phoneMappingLimited: boolean;
}

interface ScheduledSheetsActions {
  changeCampus: (value: string) => void;
  refresh: () => Promise<void>;
  selectConnector: (row: ApiObject) => void;
  newConnector: () => void;
  save: (form: FormData) => Promise<void>;
  setSourceMode: (value: string) => void;
  setIdentityMode: (value: string) => void;
  changeColumn: (index: number, key: string, value: ApiValue) => void;
  simulate: () => Promise<void>;
  runManually: () => Promise<void>;
  history: (page?: number) => Promise<void>;
  readReconciliation: (page?: number) => Promise<void>;
}

const targets = ["firstName", "lastName", "email", "phone", "externalId", "educationLevel", "program", "campus", "campaign", "historicalStatus", "occurredAt"];
const actions = ["DIRECT", "TRIM", "LOWERCASE", "PHONE", "DATE", "METADATA", "IGNORE"];
const fieldLabels: Record<string, string> = { firstName: "Prénom", lastName: "Nom", email: "Email", phone: "Téléphone", externalId: "Identifiant de soumission", educationLevel: "Niveau d’études", program: "Formation", campus: "Campus", campaign: "Campagne", historicalStatus: "Statut d’origine", occurredAt: "Date de soumission" };
const actionLabels: Record<string, string> = { DIRECT: "Conserver la valeur", TRIM: "Retirer les espaces superflus", LOWERCASE: "Convertir en minuscules", PHONE: "Normaliser le téléphone", DATE: "Lire la date", METADATA: "Information complémentaire", IGNORE: "Ne pas importer" };
const runLabels: Record<string, string> = { COMPLETED: "Terminé", RUNNING: "En cours", PENDING: "En attente", QUEUED: "En attente", FAILED: "Échec", CANCELLED: "Annulé", INTERRUPTED: "Interrompu", SIMULATION: "Simulation", SCHEDULED: "Planifié", MANUAL: "À la demande" };
const sourceLabels: Record<string, string> = { WEB_FORM: "Formulaire web", PHONE_CALL: "Appel téléphonique", PHYSICAL_VISIT: "Visite sur place", WEBSITE: "Site web", EVENT: "Événement", PARTNER: "Partenaire", JOBINTECH: "JobInTech", LEGACY_IMPORT: "Reprise historique", MANUAL_ENTRY: "Saisie manuelle", OTHER_CONTROLLED: "Autre source contrôlée" };

function ExecutionFeedback({ feedback }: { feedback: Feedback }): React.JSX.Element {
  const busy = feedback.kind === "loading";
  return <div className="sheets-feedback" aria-busy={busy}>{busy ? <p role="status">{feedback.message}</p> : null}
    {feedback.kind === "error" ? <p role="alert" className="sheets-error">{feedback.message}</p> : null}
    {feedback.kind === "success" ? <p role="status" className="sheets-success">{feedback.message}</p> : null}</div>;
}

function SourceNotice({ sourceMode }: Pick<ScheduledSheetsModel, "sourceMode">): React.JSX.Element {
  const real = sourceMode === "GOOGLE";
  return <aside className={`sheets-notice sheets-source-notice ${real ? "is-real" : "is-simulated"}`}>
    <div className="sheets-notice-heading"><span className="sheets-mode-pill">{real ? "Mode réel" : "Mode simulé"}</span><strong>{real ? "Lecture Google réelle — accès limité" : "Source simulée — aucun accès Google"}</strong></div>
    <p>Le connecteur est désactivé par défaut. Un seul canal automatique peut être actif. Le mode réel ne remplace jamais une erreur Google par des données simulées.</p><Link href="/imports/wizard">Ouvrir l’import manuel</Link>
  </aside>;
}

function CampusControls({ model, actions: pageActions }: { model: ScheduledSheetsModel; actions: ScheduledSheetsActions }): React.JSX.Element {
  return <><section className="sheets-panel sheets-controls"><ReferenceSelect name="consultedCampus" label="Campus à consulter" options={model.campuses} value={model.campus} disabled={model.busy} onChange={pageActions.changeCampus} />
    <button type="button" disabled={!model.campus || model.busy} onClick={() => { void pageActions.refresh(); }}>Charger / actualiser</button>
    {model.refreshed ? <small>Données actualisées à {model.refreshed}</small> : null}</section>
    {model.feedbackArea === "overview" ? <ExecutionFeedback feedback={model.feedback} /> : null}</>;
}

function ConnectorNavigation({ model, actions: pageActions }: { model: ScheduledSheetsModel; actions: ScheduledSheetsActions }): React.JSX.Element {
  return <><nav aria-label="Configurations Sheets" className="sheets-controls">{model.connectors.map((row) => <button key={apiString(row, "id")} type="button" disabled={model.busy} aria-pressed={apiString(row, "id") === model.id} onClick={() => pageActions.selectConnector(row)}>{apiString(row, "tab")} · v{apiString(row, "version")} · {row.enabled ? "Actif" : "Désactivé"}</button>)}
    <button type="button" disabled={model.busy} onClick={pageActions.newConnector}>Nouvelle configuration</button></nav>
    {!model.connectors.length ? <p>Aucune configuration pour ce campus. Créez une première version désactivée.</p> : null}</>;
}

function SourceFields({ model, setSourceMode }: { model: ScheduledSheetsModel; setSourceMode: (value: string) => void }): React.JSX.Element {
  let access = "Données de démonstration locales";
  let detail = "Aucun appel à Google n’est effectué.";
  if (model.sourceMode === "GOOGLE") {
    access = model.googleReady ? "Google Sheets prêt en lecture seule" : "Configuration serveur requise";
    detail = "L’activation du connecteur reste une action distincte.";
  }
  return <fieldset id="sheets-source" disabled={model.busy} className="sheets-grid"><legend>1 · Connexion au classeur</legend>
    <label>Source<select name="sourceMode" value={model.sourceMode} onChange={(event) => setSourceMode(event.target.value)}><option value="SIMULATED">Données simulées</option><option value="GOOGLE">Google Sheets en lecture seule</option></select></label>
    <label>Classeur<input name="workbook" type="url" required defaultValue={`https://docs.google.com/spreadsheets/d/${apiString(model.selected, "workbookId", "synthetic_crmy171")}/edit`} /></label>
    <label>Onglet<input name="tab" required maxLength={100} defaultValue={apiString(model.selected, "tab", "Synthétique")} /></label>
    <label>Numéro de l’onglet (gid)<input name="sheetId" type="number" min={0} step={1} required defaultValue={apiString(model.source, "sheetId", "0")} /></label>
    <label>Plage autorisée, en-têtes inclus<input name="range" required defaultValue={apiString(model.source, "range", "A1:CW10002")} /><small>La sélection doit correspondre exactement à la source autorisée côté serveur. Aucune extension automatique.</small></label>
    <div className="sheets-source-state"><span className="sheets-state-label">Accès à la source</span><strong>{access}</strong><span>{detail}</span></div>
    {model.realUnavailable ? <p className="sheets-inline-warning">Accès Google non configuré côté serveur. Enregistrement désactivé possible ; lecture et activation indisponibles. Aucun credential à saisir ici.</p> : null}
  </fieldset>;
}

function ScopeFields({ model }: { model: ScheduledSheetsModel }): React.JSX.Element {
  return <fieldset id="sheets-scope" disabled={model.busy} className="sheets-reference-section"><legend>2 · Campus et périmètre des prospects</legend>
    <LeadReferenceSelectors initial={{ campus: apiString(model.context, "campus", model.campus), program: apiString(model.context, "program"), campaign: apiString(model.context, "campaign") }} />
    <label>Niveau par défaut<input name="educationLevel" required defaultValue={apiString(model.context, "educationLevel", "BAC")} /></label>
  </fieldset>;
}

function LocalIdentityFields({ context }: { context: ApiObject }): React.JSX.Element {
  return <><label>Canal d’origine<select name="businessSource" defaultValue={apiString(context, "source", "OTHER_CONTROLLED")}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <p>Le suivi local conserve les positions et détecte les changements observables. Une modification ou réorganisation peut suspendre l’import pour vérification. Ce mode ne crée aucun identifiant dans le classeur.</p>
    <label>Origine déclarée des soumissions<input name="originalSource" required maxLength={120} defaultValue={apiString(context, "originalSource")} /><small>Indiquez l’origine connue ou explicitement non déterminée. Aucune origine Forminator n’est déduite.</small></label></>;
}

function MappingRow({ column, index, changeColumn }: { column: ApiObject; index: number; changeColumn: ScheduledSheetsActions["changeColumn"] }): React.JSX.Element {
  return <article className="sheets-map-row">
    <label>Colonne source {index + 1}<input required value={apiString(column, "sourceColumn")} onChange={(event) => changeColumn(index, "sourceColumn", event.target.value)} /></label>
    <label>Information du prospect {index + 1}<select value={apiString(column, "targetField")} onChange={(event) => changeColumn(index, "targetField", event.target.value)}><option value="">Information complémentaire / ignorée</option>{targets.map((target) => <option key={target} value={target}>{fieldLabels[target] ?? target}</option>)}</select></label>
    <label>Traitement de la valeur {index + 1}<select value={apiString(column, "action")} onChange={(event) => changeColumn(index, "action", event.target.value)}>{actions.map((action) => <option key={action} value={action}>{actionLabels[action] ?? action}</option>)}</select></label>
    <label className="sheets-check"><input type="checkbox" checked={column.required === true} onChange={(event) => changeColumn(index, "required", event.target.checked)} />Obligatoire</label>
  </article>;
}

function MappingFields({ model, actions: pageActions }: { model: ScheduledSheetsModel; actions: ScheduledSheetsActions }): React.JSX.Element {
  const localRows = model.identityMode === "LOCAL_ROW";
  return <fieldset id="sheets-mapping" disabled={model.busy}><legend>3 · Correspondance des colonnes</legend>
    <label>Identification des soumissions<select name="identityMode" value={model.identityMode} onChange={(event) => pageActions.setIdentityMode(event.target.value)}><option value="EXTERNAL_ID">Identifiant de soumission fourni par la source</option><option value="LOCAL_ROW">Suivi local des lignes sans identifiant source</option></select></label>
    {localRows ? <LocalIdentityFields context={model.context} /> : <p>Chaque soumission doit avoir un identifiant stable. Les lignes sans identifiant seront à vérifier, sans création automatique.</p>}
    <div className="sheets-grid"><label>Référence de la correspondance<input name="mappingKey" required defaultValue={apiString(model.mapping, "mappingKey", "synthetic-sheet")} /></label>
      <label>Nom de la correspondance<input name="mappingName" required defaultValue={apiString(model.mapping, "name", "Mapping synthétique")} /></label></div>
    {model.phoneMappingLimited ? <aside className="sheets-mapping-note" role="note"><strong>Téléphone non importé pour cette source</strong><p>Les colonnes téléphoniques restent des informations complémentaires : leur format ne permet pas une normalisation fiable sans inventer un préfixe ou modifier le numéro.</p></aside> : null}
    <div className="sheets-mapping">{model.columns.map((column, index) => <MappingRow key={index} column={column} index={index} changeColumn={pageActions.changeColumn} />)}</div>
  </fieldset>;
}

function ScheduleFields({ model }: { model: ScheduledSheetsModel }): React.JSX.Element {
  const assignment = sheetApiObject(model.configuration.assignment);
  return <fieldset id="sheets-schedule" disabled={model.busy} className="sheets-grid"><legend>4 · Planification et affectation</legend>
    <label>Intervalle entre les imports (minutes)<input name="interval" type="number" min={5} max={15} required defaultValue={apiString(model.selected, "intervalMinutes", "15")} /><small>De 5 à 15 minutes, même lorsque le navigateur est fermé.</small></label>
    <label>Mode d’affectation<select name="strategy" defaultValue={apiString(assignment, "strategy", "UNASSIGNED")}><option value="UNASSIGNED">Non affecté</option><option value="FIXED">Conseiller fixe</option><option value="ROUND_ROBIN">À tour de rôle</option><option value="CONTROLLED_RANDOM">Aléatoire contrôlé</option></select></label>
    <label>Conseiller fixe (identifiant autorisé)<input name="target" defaultValue={apiString(assignment, "targetUserId")} /></label>
    <label className="sheets-check"><input type="checkbox" name="enabled" disabled={model.realUnavailable} defaultChecked={model.selected.enabled === true} />Activer les imports automatiques</label>
    <p className="sheets-section-intro">L’activation des imports ne remplace pas les règles d’affectation automatique du campus. Une configuration enregistrée peut rester désactivée.</p>
  </fieldset>;
}

function ConfirmedState({ selected }: { selected: ApiObject }): React.JSX.Element {
  if (!apiString(selected, "id")) return <p className="sheets-persisted-state">Configuration non enregistrée</p>;
  return <p className="sheets-persisted-state">État enregistré : <strong>{selected.enabled === true ? "Imports automatiques actifs" : "Imports automatiques désactivés"}</strong> · version {apiString(selected, "version")}</p>;
}

function ConfigurationForm({ model, actions: pageActions }: { model: ScheduledSheetsModel; actions: ScheduledSheetsActions }): React.JSX.Element {
  return <form key={`${model.id}:${apiString(model.selected, "version")}`} onSubmit={(event) => { event.preventDefault(); void pageActions.save(new FormData(event.currentTarget)); }} className="sheets-panel sheets-configuration" aria-busy={model.busy}>
    <h2>{model.id ? `Configuration · version ${apiString(model.selected, "version")}` : "Nouvelle configuration"}</h2>
    <p className="sheets-section-intro">Reliez les colonnes du classeur aux informations de vos prospects, puis vérifiez le résultat avant d’activer les imports.</p>
    <nav className="sheets-step-nav" aria-label="Étapes de configuration"><a href="#sheets-source">1. Connexion</a><a href="#sheets-scope">2. Périmètre</a><a href="#sheets-mapping">3. Correspondance</a><a href="#sheets-schedule">4. Planification</a></nav>
    <SourceFields model={model} setSourceMode={pageActions.setSourceMode} />
    <ScopeFields model={model} />
    <MappingFields model={model} actions={pageActions} />
    <ScheduleFields model={model} />
    <div className="sheets-save-bar"><div><strong>5 · Enregistrement et état</strong><p>La nouvelle version sera utilisée pour les prochains imports.</p><ConfirmedState selected={model.selected} /></div>
      <button className="sheets-button-primary" type="submit" disabled={model.busy || !model.columns.length}>{model.busy && model.feedbackArea === "configuration" ? "Enregistrement…" : "Enregistrer une nouvelle version"}</button>
      {model.feedbackArea === "configuration" ? <ExecutionFeedback feedback={model.feedback} /> : null}</div>
  </form>;
}

function SimulationSummary({ result, version }: { result: SheetSimulation; version: string }): React.JSX.Element {
  return <article className="sheets-simulation" aria-label="Résultat de simulation"><h3>Simulation · {result.simulated ? "Données simulées" : "Lecture Google réelle"}</h3>
    <p>Version simulée : {version} · dernière configuration sauvegardée</p>
    <dl>{[["Lignes lues", result.rows], ["Lignes admissibles", result.mapped], ["À vérifier", result.review]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    {result.rows === 0 ? <p>Aucune ligne dans la plage lue.</p> : null}
    <p>Aucun prospect créé. Les doublons et l’affectation seront contrôlés lors de l’import ; cette simulation ne les prédit pas.</p>
  </article>;
}

function Reconciliation({ model, read }: { model: ScheduledSheetsModel; read: ScheduledSheetsActions["readReconciliation"] }): React.JSX.Element | null {
  if (!model.reconciliation) return null;
  const rows = resourceObjects(model.reconciliation.rows ?? []);
  const page = Number(model.reconciliation.page ?? 1);
  return <section aria-label="Réconciliation des lignes"><h3>{model.reconciliation.suspended === true ? "Import suspendu — vérification nécessaire" : "Suivi local des lignes"}</h3><p>Aucune résolution automatique. Les coordonnées des prospects ne sont pas affichées dans ce suivi.</p>
    {!rows.length ? <p>Aucune ligne suivie.</p> : <ul>{rows.map((row) => <li key={apiString(row, "rowNumber")}>Ligne {apiString(row, "rowNumber")} · {row.errorCode ? "À vérifier" : "Suivie"} · Dernière observation : {apiString(row, "lastObservedAt", "Non disponible")}</li>)}</ul>}
    <nav aria-label="Pagination des lignes suivies" className="sheets-controls"><button type="button" disabled={model.busy || page <= 1} onClick={() => { void read(page - 1); }}>Lignes précédentes</button><span>Page {page} · 50 lignes maximum</span><button type="button" disabled={model.busy || rows.length < 50 || page >= 10_000} onClick={() => { void read(page + 1); }}>Lignes suivantes</button></nav>
  </section>;
}

function RunCard({ run }: { run: ApiObject }): React.JSX.Element {
  return <article><h3>{runLabels[apiString(run, "status")] ?? "État indisponible"} · {runLabels[apiString(run, "trigger")] ?? "Mode non renseigné"}</h3>
    <p>Configuration v{apiString(run, "configurationVersion", "—")} · {apiString(run, "startedAt", "Simulation")}</p>
    <dl>{[["createdCount", "Créés"], ["duplicateCount", "Doublons"], ["reviewCount", "À revoir"], ["ignoredCount", "Ignorés"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{apiString(run, key ?? "", "0")}</dd></div>)}</dl>
    {run.errorCode ? <p className="sheets-error">Import interrompu. Vérifiez vos droits, le classeur et la configuration avant de relancer.</p> : null}</article>;
}

function RunHistory({ model, history }: { model: ScheduledSheetsModel; history: ScheduledSheetsActions["history"] }): React.JSX.Element {
  return <>{!model.runs.length ? <p>Aucune exécution affichée. Actualisez l’historique.</p> : <div className="sheets-runs">{model.runs.map((run) => <RunCard key={apiString(run, "id")} run={run} />)}</div>}
    {model.historyPage > 0 ? <nav aria-label="Pagination de l’historique" className="sheets-controls"><button type="button" disabled={model.busy || model.historyPage === 1} onClick={() => { void history(model.historyPage - 1); }}>Exécutions précédentes</button><span>Page {model.historyPage} · 50 exécutions maximum</span><button type="button" disabled={model.busy || model.runs.length < 50 || model.historyPage >= 10_000} onClick={() => { void history(model.historyPage + 1); }}>Exécutions suivantes</button></nav> : null}</>;
}

function ExecutionPanel({ model, actions: pageActions }: { model: ScheduledSheetsModel; actions: ScheduledSheetsActions }): React.JSX.Element {
  const localRows = model.source.identityMode === "LOCAL_ROW";
  const manualDisabled = model.busy || model.savedRealUnavailable || (model.selected.enabled !== true && !localRows);
  return <section className="sheets-panel sheets-execution-panel"><div className="sheets-section-heading"><div><h2>6 · Suivi des imports</h2><p>Vérifiez les résultats des imports planifiés ou lancés à la demande.</p></div><span className={`sheets-connector-pill ${model.selected.enabled === true ? "is-active" : "is-inactive"}`}>{model.selected.enabled === true ? "Connecteur actif" : "Connecteur désactivé"}</span></div>
    <div className="sheets-action-toolbar" aria-label="Actions d’import"><div><strong>Vérifier sans écrire</strong><button className="sheets-button-primary" type="button" disabled={model.busy || model.savedRealUnavailable} onClick={() => { void pageActions.simulate(); }}>Simuler</button></div>
      <div><strong>Exécuter à la demande</strong><button type="button" disabled={manualDisabled} onClick={() => { void pageActions.runManually(); }}>Lancer manuellement</button></div>
      <div><strong>Consulter les résultats</strong><button type="button" disabled={model.busy} onClick={() => { void pageActions.history(); }}>Actualiser l’historique</button></div></div>
    {localRows ? <><p>Le lancement manuel importe uniquement le lot autorisé. Il n’active pas les prochains imports automatiques.</p><button type="button" disabled={model.busy} onClick={() => { void pageActions.readReconciliation(); }}>Consulter les lignes à vérifier</button><Reconciliation model={model} read={pageActions.readReconciliation} /></> : null}
    {model.feedbackArea === "execution" ? <ExecutionFeedback feedback={model.feedback} /> : null}
    {model.simulation ? <SimulationSummary {...model.simulation} /> : null}
    <RunHistory model={model} history={pageActions.history} />
  </section>;
}

export function ScheduledSheetsView({ model, actions: pageActions }: { model: ScheduledSheetsModel; actions: ScheduledSheetsActions }): React.JSX.Element {
  return <main className="sheets-admin"><header><p className="eyebrow">Administration · Imports</p><h1>Google Sheets planifié</h1><p>Configurez, simulez et suivez une alimentation contrôlée.</p></header>
    <SourceNotice sourceMode={model.sourceMode} />
    <CampusControls model={model} actions={pageActions} />
    {model.loaded ? <><ConnectorNavigation model={model} actions={pageActions} /><ConfigurationForm model={model} actions={pageActions} />{model.id ? <ExecutionPanel model={model} actions={pageActions} /> : null}</> : null}
  </main>;
}
