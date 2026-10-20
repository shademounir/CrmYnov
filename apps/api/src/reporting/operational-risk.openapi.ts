const count = { type: "integer", minimum: 0 } as const;
export const operationalRiskSchemas = {
  OperationalAlert: {
    type: "object", required: ["code", "severity", "count", "reason", "drillDown", "unit", "drillDownAvailability"],
    properties: {
      code: { type: "string" }, severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] }, count,
      reason: { type: "string" }, unit: { type: "string", enum: ["LEADS", "ACTIONS", "REQUESTS", "OCCURRENCES", "ACTIVE_LEAD_GAP"] },
      drillDown: { type: "string", description: "Exact scoped queue link only for EXACT_QUEUE; # for INLINE_COMPARISON or UNAVAILABLE. Never infer a Lead list from an action/request/occurrence count or load gap." },
      drillDownAvailability: { type: "string", enum: ["EXACT_QUEUE", "INLINE_COMPARISON", "UNAVAILABLE"] }, drillDownReason: { type: "string" },
      loadComparison: { type: "object", required: ["minimum", "maximum", "adviserCount", "population"], properties: {
        minimum: count, maximum: count, adviserCount: { type: "integer", minimum: 2 }, population: { type: "string", enum: ["VISIBLE_CURRENT_PRIMARY_ACTIVE_OWNERS"], description: "Same authorized Lead-created cohort as the report, active current primary portfolios only; zero-active owners excluded. count = maximum - minimum, not a selectable set of Leads." },
      } },
    },
  },
} as const;
export const operationalRiskPaths = { "/reports/operational-risks": { get: {
  summary: "Read scoped operational alerts with explicit units and qualified drilldown availability",
  description: "Read-only current stock of an authorized creation cohort. No redistribution, approval, notification delivery or business mutation. Source quality is unavailable in persistent mode until durably reconstructed, not an observed zero.",
  security: [{ bearerAuth: [] }],
  parameters: [...["period", "from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view", "treatmentFrom", "treatmentTo", "treatmentState", "noInteractionHours", "capacityWarningPercent", "loadGap", "sourceRiskPercent", "minSourceVolume"].map(name => ({ name, in: "query", schema: { type: "string" }, description: "Validated scoped reporting filter or bounded alert threshold. Creation from inclusive/to exclusive; first-treatment threshold fixed24h. No visibility grant." }))],
  responses: { "200": { description: "Authorized aggregates. Mixed units must not be added as distinct Leads; comparison data has no adviser identity or task notes.", content: { "application/json": { schema: {
    type: "object", required: ["definitionVersion", "generatedAt", "timezone", "alerts", "sourceQualityAvailability"], properties: {
      definitionVersion: { type: "string", enum: ["operational-risk-v1"] }, generatedAt: { type: "string", format: "date-time" }, timezone: { type: "string", enum: ["Africa/Casablanca"] },
      alerts: { type: "array", items: { $ref: "#/components/schemas/OperationalAlert" } }, sourceQualityAvailability: { type: "string", enum: ["LOCAL_SYNTHETIC_OCCURRENCES", "UNAVAILABLE_NOT_DURABLY_RECONSTRUCTED"] },
    },
  } } } }, "400": { description: "Invalid query or threshold" }, "401": { description: "Session required" }, "403": { description: "Pilotage or resource scope refused; no decision power granted" }, "503": { description: "Persistence or permission unavailable" } },
} } } as const;
