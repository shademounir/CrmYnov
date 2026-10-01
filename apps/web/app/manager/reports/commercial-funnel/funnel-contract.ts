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
  definitionVersion: "commercial-funnel-v1";
  timezone: "Africa/Casablanca";
  generatedAt: string;
  total: number;
  counts: Record<(typeof stages)[number]["key"], number>;
  temperatureDistribution: Record<(typeof temperatures)[number]["key"], number>;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
export function parseSnapshot(value: unknown): FunnelSnapshot {
  if (!record(value) || !record(value.cohort) || !record(value.currentState)
    || value.definitionVersion !== "commercial-funnel-v1" || value.timezone !== "Africa/Casablanca"
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || !count(value.cohort.totalUniqueLeads)) throw new Error("invalid_report");
  if (!record(value.temperatureDistribution)) throw new Error("invalid_report");
  const { PROSPECT, CONTACTED, QUALIFIED, ENROLLED, CLOSED_LOST } = value.currentState;
  const { UNEVALUATED, COLD, WARM, HOT } = value.temperatureDistribution;
  if (!count(PROSPECT) || !count(CONTACTED) || !count(QUALIFIED) || !count(ENROLLED) || !count(CLOSED_LOST)) throw new Error("invalid_report");
  if (!count(UNEVALUATED) || !count(COLD) || !count(WARM) || !count(HOT)) throw new Error("invalid_report");
  if (PROSPECT + CONTACTED + QUALIFIED + ENROLLED + CLOSED_LOST !== value.cohort.totalUniqueLeads) throw new Error("inconsistent_report");
  if (UNEVALUATED + COLD + WARM + HOT !== value.cohort.totalUniqueLeads) throw new Error("inconsistent_report");
  return { definitionVersion: value.definitionVersion, timezone: value.timezone, generatedAt: value.generatedAt, total: value.cohort.totalUniqueLeads, counts: { PROSPECT, CONTACTED, QUALIFIED, ENROLLED, CLOSED_LOST }, temperatureDistribution: { UNEVALUATED, COLD, WARM, HOT } };
}

export function buildLeadListHref(filters: Record<string, string>, dimension?: { status?: string; temperature?: string }): string {
  const query = new URLSearchParams();
  const pipelineQuery = new URLSearchParams();
  const mapping = { from: "createdFrom", campus: "campus", campaign: "campaign", program: "program", source: "source" } as const;
  for (const [pipelineKey, leadKey] of Object.entries(mapping)) {
    const value = filters[pipelineKey]?.trim();
    if (value) { query.set(leadKey, value); pipelineQuery.set(pipelineKey, value); }
  }
  const exclusiveTo = filters.to?.trim();
  if (exclusiveTo) {
    const boundary = new Date(exclusiveTo);
    if (Number.isFinite(boundary.valueOf())) { query.set("createdTo", new Date(boundary.valueOf() - 1).toISOString()); pipelineQuery.set("to", exclusiveTo); }
  }
  if (dimension?.status) query.set("status", dimension.status);
  if (dimension?.temperature) query.set("temperature", dimension.temperature);
  const serializedPipeline = pipelineQuery.toString();
  query.set("returnTo", serializedPipeline ? `/manager/reports/commercial-funnel?${serializedPipeline}` : "/manager/reports/commercial-funnel");
  const serialized = query.toString();
  return `/leads?${serialized}`;
}
