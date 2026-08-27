"use client";

import { useEffect, useState } from "react";

interface Report { jobId: string; mappingId: string; mappingVersion: number; total: number; created: number; updated: number; ignored: number; duplicates: number; errors: number; reconciled: true; rejectionCount: number }
const API = "/api/crm";

export default function ImportReportPage({ params }: Readonly<{ params: { jobId: string } }>): React.JSX.Element {
  const [report, setReport] = useState<Report | null>(null); const [error, setError] = useState("");
  useEffect(() => { void fetch(`${API}/lead-import/reports/${encodeURIComponent(params.jobId)}`, { credentials: "include" })
    .then(async (response) => response.ok ? response.json() as Promise<Report> : Promise.reject(new Error("report_load_failed")))
    .then(setReport).catch(() => setError("Rapport indisponible ou accès refusé.")); }, [params.jobId]);
  return <main><h1>Rapport d’import</h1><p>Réconciliation expurgée, sans identité de lead ni valeur source.</p>
    {error ? <p role="alert">{error}</p> : null}
    {report ? <section><h2>Job {report.jobId}</h2><p>Mapping {report.mappingId} — v{report.mappingVersion}</p>
      <dl><dt>Total</dt><dd>{report.total}</dd><dt>Créés</dt><dd>{report.created}</dd><dt>Mis à jour</dt><dd>{report.updated}</dd>
        <dt>Ignorés</dt><dd>{report.ignored}</dd><dt>Doublons</dt><dd>{report.duplicates}</dd><dt>Erreurs</dt><dd>{report.errors}</dd></dl>
      <p>Réconcilié : {report.reconciled ? "oui" : "non"}</p>
      <a href={`${API}/lead-import/reports/${encodeURIComponent(report.jobId)}/rejections`}>Exporter {report.rejectionCount} rejet(s) expurgé(s)</a>
    </section> : null}</main>;
}
