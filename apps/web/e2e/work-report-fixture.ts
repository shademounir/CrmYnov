/** Synthetic browser-route data only; never an API, seed, business write or PROD evidence. */
export function syntheticWorkReport(query: URLSearchParams): Record<string, unknown> {
  const generatedAt = "2026-10-20T12:00:00.000Z";
  const rows = [
    { id: "synthetic-work-first", leadCode: "LD-2026-001", firstName: "Prospect", lastName: "Synthétique", status: "PROSPECT", createdAt: "2026-10-18T10:00:00.000Z", receivedAt: "2026-10-18T10:00:00.000Z", treatmentState: "NONE", lastTreatmentAt: "", hasActiveNextAction: false, nextActionAt: "", firstTreatmentPending: true, firstTreatmentOverdue: true },
    { id: "synthetic-work-action", leadCode: "LD-2026-002", firstName: "Suivi", lastName: "Synthétique", status: "CONTACTED", createdAt: "2026-10-19T10:00:00.000Z", receivedAt: "2026-10-19T10:00:00.000Z", treatmentState: "DATED", lastTreatmentAt: "2026-10-19T11:00:00.000Z", hasActiveNextAction: true, nextActionAt: "2026-10-19T16:00:00.000Z", firstTreatmentPending: false, firstTreatmentOverdue: false },
    { id: "synthetic-work-enrolled", leadCode: "LD-2026-003", firstName: "Inscription", lastName: "Synthétique", status: "ENROLLED", createdAt: "2026-10-20T09:00:00.000Z", receivedAt: "2026-10-20T09:00:00.000Z", treatmentState: "DATED", lastTreatmentAt: "2026-10-20T10:00:00.000Z", hasActiveNextAction: false, nextActionAt: "", firstTreatmentPending: false, firstTreatmentOverdue: false },
  ].map(row => ({ ...row, campus: "campus-a", campaign: "CAMPAIGN_SYNTHETIC", source: "SYNTHETIC", program: "PROGRAM_SYNTHETIC", acquisitionKind: "NEW", receptionOrigin: "CRM_OBSERVATION", hasUndatedHistory: false, assignedToId: "adviser-synthetic", assignedToLabel: "Conseiller synthétique",
    firstTreatmentAgeMinutes: row.firstTreatmentPending ? Math.floor((Date.parse(generatedAt) - Date.parse(row.receivedAt)) / 60_000) : null,
    firstTreatmentDeadlineAt: row.firstTreatmentPending ? new Date(Date.parse(row.receivedAt) + 86_400_000).toISOString() : null }));
  const exact = (actual: string, key: string): boolean => !query.get(key) || actual === query.get(key);
  const cohort = rows.filter(row => exact(row.campus, "campus") && exact(row.campaign, "campaign") && exact(row.source, "source") && exact(row.program, "program") && exact(row.status, "status") && exact(row.assignedToId, "adviserId") && exact(row.treatmentState, "treatmentState")
    && (!query.get("from") || Date.parse(row.createdAt) >= Date.parse(query.get("from")!)) && (!query.get("to") || Date.parse(row.createdAt) < Date.parse(query.get("to")!)));
  const selection = {
    NEW_RECEIVED: [...cohort].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    TO_CONTACT: cohort.filter(row => row.firstTreatmentPending), FIRST_TREATMENT_OVERDUE: cohort.filter(row => row.firstTreatmentOverdue),
    ACTIVE_FOLLOW_UP: cohort.filter(row => row.hasActiveNextAction), OVERDUE_FOLLOW_UP: cohort.filter(row => row.hasActiveNextAction),
    NEXT_ACTION_MISSING: [], PENDING_CLOSURE: [],
  };
  type Key = keyof typeof selection;
  const selectedQueue = (query.get("queue") ?? "NEW_RECEIVED") as Key;
  if (!Object.hasOwn(selection, selectedQueue)) throw new Error("synthetic_work_queue_invalid");
  const labels: Record<Key, string> = { NEW_RECEIVED: "Nouveaux reçus", TO_CONTACT: "À contacter", FIRST_TREATMENT_OVERDUE: "Premier traitement en retard", ACTIVE_FOLLOW_UP: "Relances en attente", OVERDUE_FOLLOW_UP: "Relances en retard", NEXT_ACTION_MISSING: "Prochaine action manquante", PENDING_CLOSURE: "Clôtures à valider" };
  const queues = (primary: boolean): Array<Record<string, unknown>> => (Object.keys(selection) as Key[]).map(key => {
    const params = new URLSearchParams(query); params.set("queue", key); params.set("contractVersion", "2"); params.delete("page");
    if (primary) { params.set("adviserId", "adviser-synthetic"); params.set("adviserScope", "PRIMARY"); }
    const amount = selection[key].length, unit = key.includes("FOLLOW_UP") ? "ACTIONS" : key === "PENDING_CLOSURE" ? "REQUESTS" : "LEADS";
    const denominatorKey = key === "FIRST_TREATMENT_OVERDUE" ? "TO_CONTACT" : key === "OVERDUE_FOLLOW_UP" ? "ACTIVE_FOLLOW_UP" : undefined;
    const denominator = denominatorKey ? selection[denominatorKey].length : 0;
    return { key, label: labels[key], leadCount: amount, itemCount: amount, itemUnit: unit, href: `/manager/reports/commercial-work?${params}`, leadShare: { numerator: amount, denominator: cohort.length, value: cohort.length ? amount / cohort.length : null },
      ...(denominatorKey ? { subsetRate: { numerator: amount, denominator, value: denominator ? amount / denominator : null, unit, denominatorQueue: denominatorKey, label: "Part de la file de référence" } } : {}) };
  });
  const actions = { active: selection.ACTIVE_FOLLOW_UP.length, future: 0, dueNow: 0, overdue: selection.OVERDUE_FOLLOW_UP.length, invalidDeadline: 0, completed: 0, cancelled: 0 };
  const page = Number(query.get("page") ?? "1"), pageSize = Number(query.get("pageSize") ?? "12"), items = selection[selectedQueue];
  return { definitionVersion: "commercial-work-v2", generatedAt, timezone: "Africa/Casablanca", selectedQueue, filters: Object.fromEntries(query),
    definitions: ["Recette navigateur synthétique isolée, pas un relevé PROD."], cohort: { leadCount: cohort.length, attribution: "CURRENT_PRIMARY_ADVISER", dateBasis: "LEAD_CREATED_COHORT_CURRENT_STATE", ...(query.get("from") ? { from: query.get("from") } : {}), ...(query.get("to") ? { to: query.get("to") } : {}) },
    actions, queues: queues(false), advisers: cohort.length ? [{ adviserId: "adviser-synthetic", adviserLabel: "Conseiller synthétique", leadCount: cohort.length, actions, queues: queues(true) }] : [],
    page: { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length } };
}
