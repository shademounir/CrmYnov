export const dashboardCapabilityFields = ["canCreateLead", "canReadRecentLeads", "canViewManagerDashboard", "canViewPersonalDashboard", "canViewPilotageDashboard", "canExportReporting"] as const;
export const dashboardCapabilityPaths = {
  "/reports/dashboard/capabilities": { get: {
    summary: "Read current server-evaluated lead creation, recent lead and pilotage dashboard capabilities",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "campus", in: "query", required: false, schema: { type: "string" }, description: "Optional server-resolved campus; all other query fields are rejected" }],
    responses: {
      "200": { description: "Independent booleans, no user or lead identities and no grants changed", content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: dashboardCapabilityFields,
        properties: Object.fromEntries(dashboardCapabilityFields.map((key) => [key, { type: "boolean" }])),
      } } } },
      "400": { description: "Unknown or invalid campus filter" }, "401": { description: "Current authenticated session required" },
      "403": { description: "Session or campus scope refused" }, "503": { description: "Authorization store unavailable; no role-based fallback" },
    },
  } },
} as const;
