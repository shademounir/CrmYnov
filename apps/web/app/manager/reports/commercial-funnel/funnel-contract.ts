export const stages = [
  { key: "PROSPECT", label: "Prospects" }, { key: "CONTACTED", label: "Contactés" },
  { key: "QUALIFIED", label: "Qualifiés" }, { key: "ENROLLED", label: "Inscrits" },
  { key: "CLOSED_LOST", label: "Sans suite" },
] as const;
export const temperatures = [
  { key: "UNEVALUATED", label: "Non évalué" }, { key: "COLD", label: "Froid" },
  { key: "WARM", label: "Tiède" }, { key: "HOT", label: "Chaud" },
] as const;
export interface FunnelSnapshot {
  generatedAt: string;
  total: number;
  counts: Record<(typeof stages)[number]["key"], number>;
  temperatureDistribution: Record<(typeof temperatures)[number]["key"], number>;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
export function parseSnapshot(value: unknown): FunnelSnapshot {
  if (!record(value) || !record(value.cohort) || !record(value.currentState)
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || !count(value.cohort.totalUniqueLeads)) throw new Error("invalid_report");
  if (!record(value.temperatureDistribution)) throw new Error("invalid_report");
  const { PROSPECT, CONTACTED, QUALIFIED, ENROLLED, CLOSED_LOST } = value.currentState;
  const { UNEVALUATED, COLD, WARM, HOT } = value.temperatureDistribution;
  if (!count(PROSPECT) || !count(CONTACTED) || !count(QUALIFIED) || !count(ENROLLED) || !count(CLOSED_LOST)) throw new Error("invalid_report");
  if (!count(UNEVALUATED) || !count(COLD) || !count(WARM) || !count(HOT)) throw new Error("invalid_report");
  if (PROSPECT + CONTACTED + QUALIFIED + ENROLLED + CLOSED_LOST !== value.cohort.totalUniqueLeads) throw new Error("inconsistent_report");
  if (UNEVALUATED + COLD + WARM + HOT !== value.cohort.totalUniqueLeads) throw new Error("inconsistent_report");
  return { generatedAt: value.generatedAt, total: value.cohort.totalUniqueLeads, counts: { PROSPECT, CONTACTED, QUALIFIED, ENROLLED, CLOSED_LOST }, temperatureDistribution: { UNEVALUATED, COLD, WARM, HOT } };
}
