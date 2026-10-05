"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Indicators = { total: number; assigned: number; unassigned: number; pending: number };

export function assignmentIndicators(value: unknown): Indicators {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("assignment_dashboard_invalid");
  const row = value as { leads?: Record<string, unknown>; activity?: Record<string, unknown> };
  const values = [row.leads?.total, row.leads?.assigned, row.leads?.unassigned, row.activity?.pendingReassignments];
  if (!values.every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)) throw new Error("assignment_dashboard_invalid");
  return { total: values[0] as number, assigned: values[1] as number, unassigned: values[2] as number, pending: values[3] as number };
}

export function AssignmentDashboard(): React.JSX.Element {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [values, setValues] = useState<Indicators>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/crm/assignment/dashboard", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) { setError(response.status === 401 ? "Votre session a expiré." : response.status === 403 ? "Les indicateurs ne sont pas autorisés dans votre périmètre." : "Les indicateurs sont indisponibles."); setState("error"); return; }
        setValues(assignmentIndicators(await response.json())); setState("ready");
      }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) { setError("Les indicateurs ne sont pas confirmés par l’API."); setState("error"); } });
    return (): void => controller.abort();
  }, []);
  if (state === "loading") return <p role="status">Chargement des indicateurs d’affectation…</p>;
  if (state === "error" || !values) return <p role="alert">{error}</p>;
  return <section className="assignment-indicators panel" aria-label="Indicateurs d’affectation"><dl>
    <div><dt>Total du périmètre</dt><dd>{values.total}</dd></div><div><dt>Affectés</dt><dd>{values.assigned}</dd></div>
    <div><dt>À affecter</dt><dd><Link href="/leads?view=UNASSIGNED">{values.unassigned}</Link></dd></div><div><dt>Demandes en attente</dt><dd>{values.pending}</dd></div>
  </dl><p>Comptage relu depuis l’API. Les permissions de chaque dossier restent contrôlées par le serveur.</p></section>;
}
