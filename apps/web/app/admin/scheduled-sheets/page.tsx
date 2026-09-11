"use client";

import React, { useEffect, useRef, useState } from "react";
import { apiString, resourceObjects, type ApiObject, type ApiValue } from "../../_components/connected-resource";
import { loadReferences, referenceFormText, type ReferenceOption } from "../../_components/reference-controls";
import { sheetApiObject, sheetRequest, sheetSourceConfiguration, sheetSimulation, type SheetSimulation } from "./sheets-client";
import { ScheduledSheetsView, type Feedback, type FeedbackArea } from "./scheduled-sheets-view";

function simulationFeedback(value: ApiValue): Feedback {
  const result = sheetSimulation(value);
  if (result.reconciliationRequired === true) return { kind: "error", message: "Simulation bloquée : le classeur a changé ou nécessite une réconciliation. Aucune ligne ne peut être importée ; aucun prospect n’a été créé." };
  if (result.review > 0) return { kind: "success", message: `Simulation terminée sans création de prospect. ${result.review} ligne(s) à vérifier avant l’import.` };
  return { kind: "success", message: "Simulation terminée sans création de prospect." };
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
  function changeCampus(value: string): void {
    revision.current++;
    setCampus(value);
    setLoaded(false);
    setSelected({});
    setConnectors([]);
    setRuns([]);
    setHistoryPage(0);
    setFeedback({ kind: "neutral" });
  }
  function selectConnector(row: ApiObject): void {
    choose(row);
    setFeedback({ kind: "neutral" });
  }
  async function simulate(): Promise<void> {
    const version = apiString(selected, "version");
    await perform(() => sheetRequest(`/${encodeURIComponent(id)}/simulations`, "POST"), simulationFeedback,
      (value) => { setSimulation({ result: sheetSimulation(value), version }); });
  }
  async function runManually(): Promise<void> {
    await perform(() => sheetRequest(`/${encodeURIComponent(id)}/runs`, "POST", { expectedVersion: Number(selected.version) }),
      "Demande enregistrée. Consultez l’historique pour le résultat de l’import.", () => undefined);
  }
  return <ScheduledSheetsView
    model={{ campuses, campus, connectors, selected, mapping, columns, runs, feedback, feedbackArea, historyPage, simulation,
      sourceMode, identityMode, googleReady, reconciliation, loaded, refreshed, busy, id, configuration, context, source,
      realUnavailable, savedRealUnavailable, phoneMappingLimited }}
    actions={{ changeCampus, refresh, selectConnector, newConnector: () => selectConnector({}), save,
      setSourceMode, setIdentityMode, changeColumn, simulate, runManually, history, readReconciliation }}
  />;
}
