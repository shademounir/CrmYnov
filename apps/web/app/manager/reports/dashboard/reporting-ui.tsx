"use client";

import { Alarm, CaretRight, ChartBar, CheckCircle, Plus, Student, TrendUp, User, UserPlus, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../_components/ui/page-header";
import { AdmissionsAgendaLink } from "../../../appointments/admissions/agenda-link";
import { leadDirectoryStatus } from "../../../leads/lead-directory";
import type { DashboardCalendar } from "./dashboard-calendar";

type Datum = { value: string; count: number; key?: string };
type ReportingCapabilities = { canCreateLead: boolean; canReadRecentLeads: boolean; canViewManagerDashboard: boolean; canExportReporting?: boolean };
type ReportingEvidence = {
  generatedAt?: string; capabilities?: ReportingCapabilities;
  persistence?: { countsObservability?: Record<string, { state: "OBSERVED" | "AUTHORIZED_SUBSET" | "UNAVAILABLE"; reason: string | null }> };
};
type DashboardReport = {
  definitionVersion: string; timezone: string; filters: Record<string, string>;
  cards: Record<"uniqueLeads" | "enrolled" | "unassigned" | "overdueFollowUps" | "activeAlerts", number | null>;
  trends: Array<{ date: string; leadsCreated: number; leadsEnrolled: number }>;
  distributions: Record<"source" | "campaign" | "program" | "campus", Datum[]>;
  panels: {
    funnel: { currentState: Record<string, number>; rates?: { enrolled: number | null } };
    performance: { advisers: Array<{ adviserId: string; activeLoad: number; primaryLeadCount: number; secondaryLeadCount: number }> };
    operationalRisks: { alerts: Array<{ code: string; count: number; drillDown: string }>; queues: Record<string, number | null>; sourceQualityAvailability?: "LOCAL_SYNTHETIC_OCCURRENCES" | "UNAVAILABLE_NOT_DURABLY_RECONSTRUCTED" };
    sharedContributions: { contributors: Array<{ contributorId: string; primaryActionCount: number; secondaryActionCount: number }> };
  };
  drillDowns: Array<{ key: string; count: number; href: string }>;
  export: { href: string; schemaVersion: string; aggregatedOnly: true };
} & ReportingEvidence;
type PersonalDashboardReport = {
  definitionVersion: "personal-dashboard-v1"; timezone: string; filters: Record<string, string>;
  performance: { advisers: Array<{ adviserId: string; activeLoad: number; primaryLeadCount: number; secondaryLeadCount: number; followUps: { overdue: number } }> };
  contributions: { contributors: Array<{ contributorId: string; primaryActionCount: number; secondaryActionCount: number }> };
  safeguards: { personalScopeOnly: true; aggregatedOnly: true };
} & ReportingEvidence;
type ReportingReport = DashboardReport | PersonalDashboardReport;
type ReportingStateKind = "loading" | "ready" | "empty" | "error" | "session" | "forbidden";

const labels: Record<string, string> = { uniqueLeads: "Leads uniques", enrolled: "Inscriptions", unassigned: "Non affectés", overdueFollowUps: "Relances échues", activeAlerts: "Alertes actives" };
const preferenceKey = "crm-reporting-preferences-v1";
type PreferredPeriod = "7d" | "30d" | "90d";
type Preferences = { compact: boolean; showTables: boolean; preferredPeriod: PreferredPeriod; operationalThreshold: number };
const dashboardDestinationRoots = ["/leads", "/reports/manager-dashboard/export"] as const;

function safePreferences(raw: Partial<Preferences>): Preferences {
  const preferredPeriod = ["7d", "30d", "90d"].includes(raw.preferredPeriod ?? "") ? raw.preferredPeriod as PreferredPeriod : "30d";
  const threshold = Number.isInteger(raw.operationalThreshold) && Number(raw.operationalThreshold) >= 1 && Number(raw.operationalThreshold) <= 100
    ? Number(raw.operationalThreshold) : 20;
  return { compact: raw.compact === true, showTables: raw.showTables !== false, preferredPeriod, operationalThreshold: threshold };
}

export default function InteractiveReportingDashboard({ initialFilters, initialReport, initialCalendar }: Readonly<{ initialFilters: Record<string, string>; initialReport?: ReportingReport; initialCalendar: DashboardCalendar }>): React.JSX.Element {
  const [report, setReport] = useState<ReportingReport | undefined>(initialReport);
  const [state, setState] = useState<ReportingStateKind>(initialReport ? "ready" : "loading");
  const [preferences, setPreferences] = useState<Preferences>(() => safePreferences({}));
  const markSessionExpired = useCallback((): void => { setReport(undefined); setState("session"); }, []);
  const query = useMemo(() => {
    const params = new URLSearchParams(initialFilters);
    if (!params.has("period")) params.set("period", "30d");
    return params;
  }, [initialFilters]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved) setPreferences(safePreferences(JSON.parse(saved) as Partial<Preferences>));
    } catch { /* Preferences are optional when browser storage is unavailable. */ }
  }, []);
  useEffect(() => {
    if (initialReport) return;
    const controller = new AbortController();
    setReport(undefined);
    setState("loading");
    fetch(`/api/crm/reports/${query.get("view") === "personal" ? "personal-dashboard" : "manager-dashboard"}?${query.toString()}`, { credentials: "same-origin", signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { markSessionExpired(); return; }
        if (response.status === 403) { setReport(undefined); setState("forbidden"); return; }
        if (!response.ok) throw new Error(`reporting_${response.status}`);
        return response.json() as Promise<ReportingReport>;
      })
      .then((value) => {
        if (value === undefined || controller.signal.aborted) return;
        setReport(value);
        setState(reportItemCount(value) > 0 || hasUnavailableEvidence(value) ? "ready" : "empty");
      })
      .catch(() => {
        if (!controller.signal.aborted) { setReport(undefined); setState("error"); }
      });
    return (): void => controller.abort();
  }, [initialReport, query, markSessionExpired]);
  const effectiveQuery = new URLSearchParams(query);
  for (const [key, value] of Object.entries(report?.filters ?? {})) if (reportingFilterKeys.has(key)) effectiveQuery.set(key, value);
  const presentationFilters = Object.fromEntries(effectiveQuery);
  for (const key of ["from", "to"]) {
    if (initialFilters[key]) presentationFilters[key] = initialFilters[key];
    else delete presentationFilters[key];
  }
  const updatePreference = (next: Preferences): void => {
    setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* Keep the current display usable without storage. */ }
  };
  return <main className="dashboard-page" data-density={preferences.compact ? "compact" : "comfortable"}>
    <PageHeader eyebrow={initialCalendar.label} title="Centre d’activité" description="Pilotez les priorités commerciales et les admissions du jour." actions={<>{state !== "session" && <AdmissionsAgendaLink />}{report?.capabilities?.canCreateLead === true && <Link className="primary-button" href={preserveFilters("/leads/new", effectiveQuery)}><Plus size={19} weight="bold" /> Nouveau lead</Link>}</>} />
    <div className="dashboard-toolbar"><ReportingFilters key={effectiveQuery.toString()} filters={presentationFilters} calendar={initialCalendar} canViewManagerDashboard={report?.capabilities?.canViewManagerDashboard === true} /><details className="dashboard-preferences"><summary>Préférences</summary><fieldset><legend>Préférences locales non sensibles</legend>
      <label><input type="checkbox" checked={preferences.compact} onChange={(event) => updatePreference({ ...preferences, compact: event.target.checked })} /> Affichage compact</label>
      <label><input type="checkbox" checked={preferences.showTables} onChange={(event) => updatePreference({ ...preferences, showTables: event.target.checked })} /> Afficher les tableaux accessibles</label>
      <label>Période préférée <select value={preferences.preferredPeriod} onChange={(event) => updatePreference({ ...preferences, preferredPeriod: event.target.value as PreferredPeriod })}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option></select></label>
      <a href={dashboardPeriodHref(effectiveQuery, preferences.preferredPeriod)}>Appliquer la période préférée</a>
      <label>Seuil personnel de charge <input type="number" min={1} max={100} value={preferences.operationalThreshold} onChange={(event) => updatePreference({ ...preferences, operationalThreshold: Math.min(100, Math.max(1, Number.parseInt(event.target.value, 10) || 1)) })} /></label>
      <small>Ces préférences d’affichage restent dans ce navigateur et ne contiennent ni identifiant métier, ni donnée personnelle.</small>
    </fieldset></details><output className="freshness-indicator"><span aria-hidden="true" /> {reportingFreshnessLabel(state)}</output></div>
    <ReportingState state={state} report={report} showTables={preferences.showTables} query={effectiveQuery} operationalThreshold={preferences.operationalThreshold} onSessionExpired={markSessionExpired} />
  </main>;
}

function reportItemCount(report: ReportingReport): number {
  return "cards" in report
    ? Object.values(report.cards).reduce<number>((sum, item) => sum + (isObservedCount(item) ? item : 0), 0)
    : report.performance.advisers.length + report.contributions.contributors.length;
}

function reportingFreshnessLabel(state: ReportingStateKind): string {
  if (state === "loading") return "Actualisation en cours";
  if (state === "session") return "Session à renouveler";
  if (state === "forbidden") return "Lecture non autorisée";
  if (state === "error") return "Actualisation indisponible";
  return "Données de la dernière réponse API";
}

function hasUnavailableEvidence(report: ReportingReport): boolean {
  return ("cards" in report && Object.values(report.cards).some((value) => !isObservedCount(value)))
    || Object.values(report.persistence?.countsObservability ?? {}).some((value) => value.state === "UNAVAILABLE");
}

function ReportingState({ state, report, showTables, query, operationalThreshold, onSessionExpired }: Readonly<{ state: ReportingStateKind; report: ReportingReport | undefined; showTables: boolean; query: URLSearchParams; operationalThreshold: number; onSessionExpired: () => void }>): React.JSX.Element | null {
  if (state === "loading") return <section aria-live="polite" aria-busy="true"><h2>Chargement</h2><p>Calcul des indicateurs agrégés…</p></section>;
  if (state === "session") return <section role="alert"><h2>Session expirée</h2><p>Votre session a expiré ou est absente. Reconnectez-vous pour consulter vos indicateurs. Vos filtres restent conservés dans cette page.</p><Link href="/">Se reconnecter</Link></section>;
  if (state === "forbidden") return <section role="alert"><h2>Accès refusé</h2><p>Votre rôle ou votre périmètre ne permet pas de consulter ce rapport. Aucun droit supplémentaire n’est attribué.</p></section>;
  if (state === "error") return <section role="alert"><h2>Erreur de chargement</h2><p>Le rapport n’a pas pu être chargé. Réessayez sans modifier vos filtres.</p></section>;
  if (state === "empty") return <section aria-live="polite"><h2>Aucun résultat</h2><p>Aucune donnée agrégée pour les filtres sélectionnés.</p></section>;
  if (!report) return null;
  if ("cards" in report) return <DashboardContent report={report} showTables={showTables} query={query} operationalThreshold={operationalThreshold} onSessionExpired={onSessionExpired} />;
  return <PersonalDashboardContent report={report} showTables={showTables} />;
}

function PersonalDashboardContent({ report, showTables }: Readonly<{ report: PersonalDashboardReport; showTables: boolean }>): React.JSX.Element {
  const adviser = report.performance.advisers[0]; const contributor = report.contributions.contributors[0];
  const data = adviser ? [{ value: "Leads principaux", count: adviser.primaryLeadCount }, { value: "Collaborations", count: adviser.secondaryLeadCount }, { value: "Charge active", count: adviser.activeLoad }, { value: "Relances échues", count: adviser.followUps.overdue }] : [];
  const contributions = contributor ? [{ value: "Actions principales", count: contributor.primaryActionCount }, { value: "Actions secondaires", count: contributor.secondaryActionCount }] : [];
  return <><section aria-label="Vue personnelle"><h2>Mes indicateurs autorisés</h2><p>Cette vue est limitée au collaborateur connecté et à ses contributions autorisées.</p></section><div className="dashboard-personal-charts"><AccessibleChart title="Ma performance" data={data} showTable={showTables} /><AccessibleChart title="Mes contributions" data={contributions} showTable={showTables} /></div><ReportingAvailability report={report} /></>;
}

function ReportingAvailability({ report }: Readonly<{ report: ReportingReport }>): React.JSX.Element | null {
  const observations = Object.values(report.persistence?.countsObservability ?? {});
  if (observations.some((value) => value.state === "UNAVAILABLE")) return <p><output>Certains compteurs de persistance sont indisponibles ; ils ne sont pas assimilés à zéro.</output></p>;
  if (observations.some((value) => value.state === "AUTHORIZED_SUBSET")) return <p>Les compteurs de persistance couvrent uniquement les données autorisées pour cette session.</p>;
  return null;
}

type RecentLead = { id: string; leadCode: string; name: string; status: string; createdAt: string; assignedToLabel?: string };
type RecentLeadsResult = { availability: "OBSERVED" | "UNAVAILABLE"; leads: RecentLead[] };

function decodeRecentLeads(value: unknown): RecentLeadsResult {
  if (!value || typeof value !== "object" || !("availability" in value) || !("leads" in value)
    || !["OBSERVED", "UNAVAILABLE"].includes(String(value.availability)) || !Array.isArray(value.leads) || value.leads.length > 10) throw new Error("recent_leads_invalid_response");
  const leads: RecentLead[] = value.leads.map((row: unknown) => {
    if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string" || !/^[a-z\d-]+$/iu.test(row.id)
      || !("leadCode" in row) || typeof row.leadCode !== "string" || !("name" in row) || typeof row.name !== "string"
      || !("status" in row) || typeof row.status !== "string" || !("createdAt" in row) || typeof row.createdAt !== "string"
      || ("assignedToLabel" in row && typeof row.assignedToLabel !== "string")) throw new Error("recent_leads_invalid_row");
    return { id: row.id, leadCode: row.leadCode, name: row.name, status: row.status, createdAt: row.createdAt,
      ...("assignedToLabel" in row ? { assignedToLabel: row.assignedToLabel as string } : {}) };
  });
  return { availability: value.availability as RecentLeadsResult["availability"], leads };
}

function RecentDashboardLeads({ query, canRead, onSessionExpired }: Readonly<{ query: URLSearchParams; canRead: boolean; onSessionExpired: () => void }>): React.JSX.Element {
  const [result, setResult] = useState<RecentLeadsResult>();
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const params = new URLSearchParams(query);
  if (params.has("from") && params.has("to")) params.set("period", "custom");
  params.set("limit", "5");
  const queryString = params.toString();
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    setResult(undefined);
    setState("loading");
    fetch(`/api/crm/reports/dashboard/recent-leads?${queryString}`, { credentials: "same-origin", signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (response.status === 403) { setState("forbidden"); return; }
        if (!response.ok) throw new Error("recent_leads_unavailable");
        const value = decodeRecentLeads(await response.json());
        if (controller.signal.aborted) return;
        setResult(value); setState("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return (): void => controller.abort();
  }, [canRead, queryString, onSessionExpired]);
  if (!canRead) return <p className="dashboard-panel-state">Liste récente indisponible pour les autorisations de cette session.</p>;
  if (state === "loading") return <p className="dashboard-panel-state"><output aria-busy="true">Chargement des leads autorisés…</output></p>;
  if (state === "forbidden") return <p className="dashboard-panel-state" role="alert">Accès aux leads récents refusé pour cette session.</p>;
  if (state === "error" || result?.availability === "UNAVAILABLE") return <p className="dashboard-panel-state" role="alert">Liste récente indisponible. Aucune absence de lead ne peut être déduite.</p>;
  if (!result?.leads.length) return <p className="dashboard-panel-state">Aucun lead récent dans la période et le périmètre autorisés.</p>;
  return <ul className="dashboard-recent-leads" aria-label="Derniers leads autorisés">{result.leads.map((lead) => {
    const knownStatus = Object.hasOwn(recentLeadStatusClasses, lead.status);
    return <li className="dashboard-recent-lead" key={lead.id}>
      <Link className="dashboard-recent-lead__link" href={preserveFilters(`/leads/${encodeURIComponent(lead.id)}`, query)}>
        <span className="dashboard-recent-lead__identity"><strong><bdi dir="auto">{lead.name}</bdi></strong><small><bdi dir="auto">{lead.leadCode}</bdi></small></span>
        <span className="dashboard-recent-lead__details">
          <span className={`status-badge${knownStatus ? ` ${recentLeadStatusClasses[lead.status]}` : ""}`}>{leadDirectoryStatus(knownStatus ? lead.status : "UNKNOWN")}</span>
          <span className="dashboard-recent-lead__owner"><User size={14} aria-hidden="true" /><span className="sr-only">Responsable : </span><bdi dir="auto">{lead.assignedToLabel ?? "Libellé du responsable indisponible"}</bdi></span>
        </span>
        <CaretRight className="dashboard-recent-lead__arrow" size={16} aria-hidden="true" />
      </Link>
    </li>;
  })}</ul>;
}

const recentLeadStatusClasses: Readonly<Record<string, string>> = {
  PROSPECT: "nouveau", CONTACTED: "contacte", QUALIFIED: "qualifie", ENROLLED: "inscrit", CLOSED_LOST: "sans-suite",
};

const attentionLabels: Readonly<Record<string, { label: string; hint: string }>> = {
  unassigned_leads: { label: "Leads actifs non affectés", hint: "Responsable principal non attribué" },
  first_interaction_overdue: { label: "Première prise de contact en retard", hint: "Délai de première interaction dépassé" },
  follow_up_overdue: { label: "Relances échues", hint: "Relances planifiées dont l’échéance est dépassée" },
  closure_decision_pending: { label: "Décisions de clôture en attente", hint: "Décision contrôlée encore attendue" },
  reassignment_decision_pending: { label: "Décisions de réaffectation en attente", hint: "Décision contrôlée encore attendue" },
  load_gap: { label: "Écart de charge commerciale", hint: "Différence de charge atteignant le seuil configuré" },
};

function dashboardAttentionText(code: string): { label: string; hint: string } {
  if (code.startsWith("capacity_warning:")) return { label: "Capacité commerciale à examiner", hint: "Le seuil de capacité configuré est atteint" };
  if (code.startsWith("source_quality:")) return { label: "Qualité d’une source à vérifier", hint: "Rejets ou éléments à vérifier observés pour cette source" };
  return Object.hasOwn(attentionLabels, code) ? attentionLabels[code]! : { label: "Signal à vérifier", hint: "Signal agrégé fourni par les contrôles API" };
}

function DashboardAttentionList({ alerts, sourceQualityAvailability }: Readonly<{ alerts: OperationalAlert[]; sourceQualityAvailability: DashboardReport["panels"]["operationalRisks"]["sourceQualityAvailability"] }>): React.JSX.Element {
  return <>
    {alerts.length ? <ul className="dashboard-attention-list" aria-label="Points d’attention observés">{alerts.slice(0, 5).map((alert) => {
      const text = dashboardAttentionText(alert.code);
      return <li className="dashboard-attention-item" key={alert.code}>
        <span className="icon-disc small red" aria-hidden="true"><WarningCircle size={18} /></span>
        <span className="dashboard-attention-item__content"><strong>{text.label}</strong><small>{text.hint}</small></span>
        <span className="dashboard-attention-item__count">{displayCount(alert.count)}<span className="sr-only"> élément(s) concerné(s)</span></span>
      </li>;
    })}</ul> : <p className="dashboard-panel-state">Aucun point d’attention observé dans les contrôles disponibles.</p>}
    {sourceQualityAvailability === "UNAVAILABLE_NOT_DURABLY_RECONSTRUCTED" && <p className="dashboard-panel-state">Qualité des sources : non observée durablement. L’absence de signal ne garantit pas l’absence d’erreur d’import.</p>}
  </>;
}

function ReportingBoundary({ name, label, initialValue }: Readonly<{ name: "from" | "to"; label: string; initialValue: string }>): React.JSX.Element {
  const [boundary, setBoundary] = useState(initialValue);
  return <label>{label}<input type="hidden" name={name} value={boundary} /><input type="date" defaultValue={initialValue.slice(0, 10)} onChange={(event) => setBoundary(event.target.value)} /></label>;
}

function ReportingFilters({ filters, calendar, canViewManagerDashboard }: Readonly<{ filters: Record<string, string>; calendar: DashboardCalendar; canViewManagerDashboard: boolean }>): React.JSX.Element {
  const query = new URLSearchParams(filters);
  const todayHref = dashboardPeriodHref(query, "custom", calendar);
  return <div className="reporting-toolbar-content">
    <nav className="period-selector" aria-label="Période globale du dashboard">
      <Link href={todayHref} className={filters.period === "custom" ? "active" : ""}>Aujourd’hui</Link>
      <Link href={dashboardPeriodHref(query, "7d")} className={filters.period === "7d" ? "active" : ""}>7 jours</Link>
      <Link href={dashboardPeriodHref(query, "30d")} className={!filters.period || filters.period === "30d" ? "active" : ""}>30 jours</Link>
      <Link href={dashboardPeriodHref(query, "90d")} className={filters.period === "90d" ? "active" : ""}>90 jours</Link>
    </nav>
    <details className="reporting-filter-popover" suppressHydrationWarning><summary>Filtres avancés</summary><form method="get" action="/manager/reports/dashboard" aria-label="Filtres interactifs du reporting">
    <label>Période <select name="period" defaultValue={filters.period ?? "30d"}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option><option value="custom">Personnalisée</option></select></label>
    <ReportingBoundary name="from" label="Du" initialValue={filters.from ?? ""} /><ReportingBoundary name="to" label="Au (borne exclue)" initialValue={filters.to ?? ""} />
    <small>Une date saisie seule correspond à minuit UTC. Les instants ISO existants sont conservés tant que vous ne modifiez pas la date.</small>
    <label>Campus <input name="campus" defaultValue={filters.campus} /></label><label>Campagne <input name="campaign" defaultValue={filters.campaign} /></label>
    <label>Formation <input name="program" defaultValue={filters.program} /></label><label>Source <input name="source" defaultValue={filters.source} /></label>
    <label>Canal <select name="channel" defaultValue={filters.channel ?? ""}><option value="">Tous</option><option value="DIGITAL">Digital</option><option value="PHONE">Téléphone</option><option value="IN_PERSON">Présentiel</option><option value="PARTNER">Partenaire</option><option value="OTHER">Autre</option></select></label>
    <label>Commercial <input name="adviserId" defaultValue={filters.adviserId} autoComplete="off" /></label>
    <label>Statut <select name="status" defaultValue={filters.status ?? ""}><option value="">Tous</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label>
    <label>Vue <select name="view" defaultValue={filters.view ?? "global"}><option value="global" disabled={!canViewManagerDashboard}>Pilotage autorisé</option><option value="personal">Personnelle</option></select></label>
    <button type="submit">Appliquer</button> <a href={dashboardPeriodHref(query, "30d")}>Réinitialiser la période</a></form></details>
  </div>;
}

function DashboardContent({ report, showTables, query, operationalThreshold, onSessionExpired }: Readonly<{ report: DashboardReport; showTables: boolean; query: URLSearchParams; operationalThreshold: number; onSessionExpired: () => void }>): React.JSX.Element {
  const funnel = Object.entries(report.panels.funnel.currentState).map(([value, count]) => ({ value, count }));
  const loads = report.panels.performance.advisers.map((item) => ({ key: item.adviserId, value: "Libellé commercial indisponible", count: item.activeLoad }));
  const contributions = report.panels.sharedContributions.contributors.map((item) => ({ key: item.contributorId, value: "Libellé contributeur indisponible", count: item.primaryActionCount + item.secondaryActionCount }));
  const followUpsHref = preserveFilters(report.drillDowns.find((item) => item.key === "overdueFollowUps")?.href ?? "/leads?view=FOLLOW_UP", query);
  return <>
    <section className="kpi-grid" aria-label="Indicateurs clés">
      <DashboardKpi icon={UserPlus} tone="teal" label="Leads uniques" value={report.cards.uniqueLeads} hint="Périmètre sélectionné" />
      <DashboardKpi icon={CheckCircle} tone="violet" label="Qualifiés (statut actuel)" value={report.panels.funnel.currentState.QUALIFIED ?? null} hint="Statut Qualifié dans la cohorte" />
      <DashboardKpi icon={Alarm} tone="amber" label="Relances échues" value={report.cards.overdueFollowUps} hint="Nombre de relances, pas de Leads" />
      <DashboardKpi icon={CheckCircle} tone="violet" label="Leads actifs non affectés" value={report.cards.unassigned} hint="Propriétaire non attribué" />
      <DashboardKpi icon={Student} tone="green" label="Inscriptions" value={report.cards.enrolled} hint="Statut inscrit" />
      <DashboardKpi icon={TrendUp} tone="teal" label="Conversion vers inscription" value={report.panels.funnel.rates?.enrolled ?? null} format="rate" hint="Taux calculé par l’API" />
      <DashboardKpi icon={TrendUp} tone="teal" label="Alertes actives" value={report.cards.activeAlerts} hint="À surveiller" />
    </section>
    <p><small>Ces liens ouvrent des listes de travail avec les filtres de période et de périmètre conservés. Les Leads non affectés peuvent inclure des statuts terminaux ; la file des Leads à relancer n’est pas le compteur de relances ; la file sans activité est distincte du seuil de première interaction.</small></p>
    <section className="quick-queues" aria-label="Files rapides">
      <Link className="queue-item" href={preserveFilters(report.drillDowns.find((item) => item.key === "unassigned")?.href ?? "/leads?view=UNASSIGNED", query)}><span className="icon-disc small neutral"><UserPlus size={20} /></span><span>Leads actifs non affectés<strong>{displayCount(report.cards.unassigned)}</strong><small>La file ouverte inclut aussi les statuts clos.</small></span></Link>
      <Link className="queue-item" href={followUpsHref}><span className="icon-disc small amber"><Alarm size={20} /></span><span>Relances échues<strong>{displayCount(report.cards.overdueFollowUps)}</strong><small>File de Leads distincte du compteur de relances.</small></span></Link>
      <div className="queue-item"><span className="icon-disc small blue"><ChartBar size={20} /></span><span>Première interaction échue<strong>{displayCount(report.panels.operationalRisks.queues.withoutFirstInteraction, "Non observé")}</strong><small>Signal agrégé sans file équivalente disponible.</small></span></div>
      <div className="queue-item"><span className="icon-disc small red"><WarningCircle size={20} /></span><span>Imports en erreur<strong>Non observé</strong></span></div>
    </section>
    <p><Link className="text-button" href={preserveFilters("/leads?view=NO_ACTIVITY", query)}>Ouvrir les Leads sans activité — file distincte du signal de première interaction échue</Link></p>
    <div className="dashboard-primary-grid"><section className="panel priority-panel"><div className="panel-heading"><div><h2>À traiter aujourd’hui en priorité</h2><p>{report.panels.operationalRisks.alerts.length} signal(s) observé(s) par les contrôles API</p></div><Link className="text-button" href={followUpsHref}>Ouvrir les Leads à relancer</Link></div><div className="priority-table"><div className="table-row table-head"><span>Priorité</span><span>Action</span><span>Volume</span><span>File</span><span>Échéance</span></div>{report.panels.operationalRisks.alerts.slice(0, 5).map((alert) => <article className="table-row" key={alert.code}><span data-label="Priorité"><span className="status-badge en-retard"><WarningCircle size={14} weight="fill" />À examiner</span></span><span data-label="Action"><b>{alert.code}</b><small>Signal agrégé sans PII</small></span><span data-label="Volume">{displayCount(alert.count)}</span><span data-label="File">{operationalAlertHref(alert, query) === "#" ? unavailableAlertLabel(alert) : <Link href={operationalAlertHref(alert, query)}>{operationalAlertLinkLabel(alert)}</Link>}</span><span data-label="Échéance" className="due">À traiter</span></article>)}</div><Link className="panel-footer-action" href={followUpsHref}>Ouvrir ma liste de travail</Link></section><section className="panel pipeline-panel"><div className="panel-heading"><h2>Pipeline</h2><Link className="text-button" href={preserveFilters("/manager/reports/commercial-funnel", query)}>Voir le pipeline complet</Link></div><div className="pipeline-head"><span>Étape</span><span>Leads</span><span>Part</span></div>{funnel.map((item) => <div className="pipeline-row" key={item.value}><span><i className="stage-dot teal" />{item.value}</span><strong>{displayCount(item.count)}</strong><em>{pipelineShare(item.count, report.cards.uniqueLeads)}</em></div>)}</section></div>
    <div className="dashboard-secondary-grid dashboard-secondary-grid--refined">
      <section className="panel leads-panel"><div className="panel-heading"><div><h2>Derniers leads</h2><p>Créés récemment dans votre périmètre</p></div>{report.capabilities?.canReadRecentLeads === true && <Link className="text-button" href={preserveFilters(report.drillDowns.find((item) => item.key === "uniqueLeads")?.href ?? "/leads", query)}>Voir tous les leads</Link>}</div><RecentDashboardLeads query={query} canRead={report.capabilities?.canReadRecentLeads === true} onSessionExpired={onSessionExpired} /></section>
      <section className="panel activity-panel"><div className="panel-heading"><div><h2>Points d’attention</h2><p>Signaux agrégés — pas un historique d’activités</p></div></div><DashboardAttentionList alerts={report.panels.operationalRisks.alerts} sourceQualityAvailability={report.panels.operationalRisks.sourceQualityAvailability} /></section>
    </div>
    <details className="reporting-details"><summary>Analyses détaillées et tableaux accessibles</summary>
    <section aria-label="Cartes KPI"><h2>Indicateurs clés</h2><ul>{report.drillDowns.map((item) => <li key={item.key}><a href={preserveFilters(item.href, query)}><strong>{labels[item.key] ?? item.key}</strong> : {displayCount(item.count)}</a></li>)}<li><strong>Alertes actives</strong> : {displayCount(report.cards.activeAlerts)}</li></ul></section>
    {query.has("status") && query.get("status") !== "ENROLLED" && <p>Le lien Inscriptions explore le statut Inscrit en remplaçant le filtre de statut ; ce n’est pas la même cohorte que celle actuellement affichée.</p>}
    <AccessibleChart title="Funnel commercial" data={funnel} showTable={showTables} />
    <AccessibleTrend data={report.trends} showTable={showTables} />
    {(["source", "campaign", "program", "campus"] as const).map((dimension) => <AccessibleChart key={dimension} title={`Répartition par ${dimension}`} data={report.distributions[dimension]} showTable={showTables} />)}
    <AccessibleChart title="Charge commerciale" data={loads} showTable={showTables} />
    <p aria-live="polite">{loads.filter((item) => item.count >= operationalThreshold).length} charge(s) atteignent le seuil personnel d’affichage de {operationalThreshold}.</p>
    <AccessibleChart title="Contributions principales et secondaires" data={contributions} showTable={showTables} />
    <section aria-label="Alertes opérationnelles"><h2>Relances et alertes</h2>{report.panels.operationalRisks.alerts.length ? <ul>{report.panels.operationalRisks.alerts.map((alert) => <li key={alert.code}>{operationalAlertHref(alert, query) === "#" ? <span>{alert.code} : {displayCount(alert.count)} — {unavailableAlertLabel(alert).toLocaleLowerCase("fr-FR")}</span> : <a href={operationalAlertHref(alert, query)}>{alert.code} : {displayCount(alert.count)} — {operationalAlertLinkLabel(alert)}</a>}</li>)}</ul> : <p>Aucune alerte observée dans les contrôles disponibles.</p>}{report.panels.operationalRisks.sourceQualityAvailability === "UNAVAILABLE_NOT_DURABLY_RECONSTRUCTED" && <p>Qualité des sources : non observée durablement. L’absence de signal ne garantit pas l’absence d’erreur d’import.</p>}</section>
    <ReportingAvailability report={report} />
    {report.capabilities?.canExportReporting === true && <p><a href={preserveFilters(report.export.href, query)} download="crm-manager-dashboard-v1.csv">Exporter les agrégats CSV</a></p>}
    <p><small>Contrat {report.definitionVersion} — export {report.export.schemaVersion} — {report.timezone}</small></p>
    </details>
  </>;
}

type OperationalAlert = DashboardReport["panels"]["operationalRisks"]["alerts"][number];
function operationalAlertHref(alert: OperationalAlert, query: URLSearchParams): string { return alert.code === "first_interaction_overdue" ? "#" : preserveFilters(alert.drillDown, query); }
function unavailableAlertLabel(alert: OperationalAlert): string { return alert.code === "first_interaction_overdue" ? "Signal sans file équivalente" : "File indisponible"; }
function operationalAlertLinkLabel(alert: OperationalAlert): string {
  if (alert.code === "follow_up_overdue") return "Ouvrir la file distincte des Leads à relancer";
  if (alert.code === "unassigned_leads") return "Ouvrir la file non affectée (statuts clos inclus)";
  return "Ouvrir";
}

function DashboardKpi({ icon: Icon, tone, label, value, hint, format = "count" }: Readonly<{ icon: typeof UserPlus; tone: string; label: string; value: number | null; hint: string; format?: "count" | "rate" }>): React.JSX.Element {
  const observed = format === "rate" ? isObservedRate(value) : isObservedCount(value);
  const displayed = format === "rate" ? displayRate(value) : displayCount(value);
  return <article className="kpi-card"><span className={`icon-disc ${tone}`}><Icon size={25} weight="bold" /></span><div><span>{label}</span><strong>{displayed}</strong><small>{observed ? hint : "Valeur non observée"}</small></div><span className={`mini-bars ${tone}`} aria-hidden="true"><i /><i /><i /><i /><i /></span></article>;
}

function AccessibleChart({ title, data, showTable }: Readonly<{ title: string; data: Datum[]; showTable: boolean }>): React.JSX.Element {
  const max = Math.max(1, ...data.map((item) => item.count));
  const values = data.map((item) => `${item.value}: ${item.count}`).join(", ") || "aucune valeur";
  const description = `${title}. ${values}`;
  return <figure><figcaption><h2>{title}</h2></figcaption>
    <button type="button" className="reporting-chart" aria-label={description}>
      {data.map((item) => <div key={item.key ?? item.value}><span>{item.value}</span> <meter min={0} max={max} value={item.count}>{item.count}</meter> <strong>{item.count}</strong></div>)}
    </button>
    {showTable && <table><caption>Données alternatives — {title}</caption><thead><tr><th scope="col">Catégorie</th><th scope="col">Valeur</th></tr></thead><tbody>{data.map((item) => <tr key={item.key ?? item.value}><th scope="row">{item.value}</th><td>{item.count}</td></tr>)}</tbody></table>}
  </figure>;
}

function AccessibleTrend({ data, showTable }: Readonly<{ data: DashboardReport["trends"]; showTable: boolean }>): React.JSX.Element {
  const chart = data.flatMap((item) => [{ value: `${item.date} — créations`, count: item.leadsCreated }, { value: `${item.date} — inscriptions`, count: item.leadsEnrolled }]);
  return <AccessibleChart title="Évolution temporelle" data={chart} showTable={showTable} />;
}

function preserveFilters(href: string, query: URLSearchParams): string {
  const safe = safeInternalHref(href, ["/leads", "/manager/assignment", "/manager/reports/commercial-funnel", "/reports/manager-dashboard/export"]);
  if (safe === "#") return safe;
  const [path, current = ""] = safe.split("?");
  const params = new URLSearchParams(current);
  const leadDestination = path === "/leads" || path?.startsWith("/leads/");
  for (const [key, value] of query) {
    if (!reportingFilterKeys.has(key) || (leadDestination && ["period", "view"].includes(key))) continue;
    const target = leadDestination ? filterTarget(key) : key;
    if (!params.has(target)) params.set(target, value);
  }
  if (leadDestination && params.has("createdBefore")) params.delete("createdTo");
  params.set("returnTo", `/manager/reports/dashboard?${query.toString()}`);
  return `${path}?${params.toString()}`;
}

function filterTarget(key: string): string {
  if (key === "from") return "createdFrom";
  if (key === "to") return "createdBefore";
  return key;
}

const reportingFilterKeys = new Set(["period", "from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view"]);

function dashboardPeriodHref(query: URLSearchParams, period: PreferredPeriod | "custom", calendar?: DashboardCalendar): string {
  const params = new URLSearchParams([...query].filter(([key]) => reportingFilterKeys.has(key)));
  params.set("period", period);
  params.delete("from"); params.delete("to");
  if (period === "custom" && calendar) { params.set("from", calendar.from); params.set("to", calendar.to); }
  return `/manager/reports/dashboard?${params.toString()}`;
}

function isObservedCount(value: number | null | undefined): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function displayCount(value: number | null | undefined, unavailable = "Indisponible"): string { return isObservedCount(value) ? String(value) : unavailable; }
function isObservedRate(value: number | null | undefined): value is number { return isObservedCount(value) && value <= 1; }
function displayRate(value: number | null | undefined): string { return isObservedRate(value) ? new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 }).format(value) : "Indisponible"; }

function pipelineShare(count: number, total: number | null): string {
  if (!isObservedCount(total)) return "Indisponible";
  if (total === 0) return "0 %";
  return `${Math.round((count / total) * 100)} %`;
}

function safeInternalHref(href: string, allowedRoots: readonly string[] = dashboardDestinationRoots): string {
  if (!href || href.includes("\0") || href.includes("\\") || href.startsWith("//") || /^[a-z][a-z\d+.-]*:/iu.test(href)) return "#";
  const path = href.split("?")[0] ?? "";
  if (!path.startsWith("/") || path.split("/").includes("..")) return "#";
  if (!allowedRoots.some((root) => path === root || path.startsWith(`${root}/`))) return "#";
  return href;
}

export { preserveFilters, safeInternalHref };
export type { DashboardReport, PersonalDashboardReport };
