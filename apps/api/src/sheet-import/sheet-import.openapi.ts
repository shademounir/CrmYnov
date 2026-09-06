const failures = { "400": { description: "Invalid configuration or real source disabled" }, "401": { description: "Authenticated session required" },
  "403": { description: "Admin role, dynamic grant or campus ceiling refused" }, "409": { description: "Version, active run or automatic channel conflict" },
  "503": { description: "Source or persistent store unavailable; no unconfirmed success" } };
const id = { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } };
const mapping = { type: "object", required: ["mappingKey", "name", "profile", "columns"], properties: {
  mappingKey: { type: "string", pattern: "^[a-z][a-z0-9-]{2,63}$" }, name: { type: "string", maxLength: 100 }, profile: { type: "string", enum: ["FORMINATOR_ZAPIER"] },
  columns: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["sourceColumn", "action"], properties: {
    sourceColumn: { type: "string", maxLength: 200 }, targetField: { type: "string", enum: ["firstName", "lastName", "email", "phone", "educationLevel", "program", "campus", "campaign", "externalId", "historicalStatus", "occurredAt", "comment"] },
    action: { type: "string", enum: ["DIRECT", "TRIM", "LOWERCASE", "PHONE", "DATE", "METADATA", "IGNORE"] }, required: { type: "boolean" }, reason: { type: "string" },
  } } },
} };
export const sheetConfigurationSchema = { type: "object", required: ["expectedVersion", "enabled", "workbookLink", "tab", "campusId", "mapping", "context", "assignment"], properties: {
  expectedVersion: { type: "integer", minimum: 0 }, enabled: { type: "boolean", default: false }, intervalMinutes: { type: "integer", minimum: 5, maximum: 15, default: 15 },
  workbookLink: { type: "string", description: "Controlled docs.google.com spreadsheet link; only synthetic_ workbooks accepted until separate real activation approval" },
  tab: { type: "string", maxLength: 100 }, campusId: { type: "string", description: "Server-resolved canonical campus UUID or code" }, mapping,
  context: { type: "object", required: ["source", "technicalSystem", "campus", "campaign"], properties: { source: { type: "string", enum: ["WEB_FORM"] },
    technicalSystem: { type: "string", enum: ["FORMINATOR_ZAPIER"] }, campus: { type: "string" }, campaign: { type: "string" }, program: { type: "string" }, educationLevel: { type: "string" } } },
  assignment: { type: "object", required: ["strategy"], properties: { strategy: { type: "string", enum: ["UNASSIGNED", "FIXED", "ROUND_ROBIN", "CONTROLLED_RANDOM"] }, targetUserId: { type: "string", format: "uuid" } } },
} };
function operation(summary: string, status: string, schema?: object): object {
  return { summary, security: [{ bearerAuth: [] }], ...(schema ? { requestBody: { required: true, content: { "application/json": { schema } } } } : {}),
    responses: { [status]: { description: "Current scoped result; configuration version is optimistic and run snapshots are immutable" }, ...failures } };
}
export const sheetImportPaths = {
  "/scheduled-sheets": { get: { ...operation("List campus configurations and canonical mapping templates; synthetic source only", "200"),
    parameters: [{ in: "query", name: "campus", required: true, schema: { type: "string" } }] }, post: operation("Create a persistent versioned connector (disabled by default)", "201", sheetConfigurationSchema) },
  "/scheduled-sheets/{id}": { parameters: [id], put: operation("Save a new immutable configuration revision; enforce a single automatic channel", "200", sheetConfigurationSchema) },
  "/scheduled-sheets/{id}/simulations": { parameters: [id], post: operation("Read a simulated source outside transactions and reauthorize before validating mapping/references; no Lead writes", "201") },
  "/scheduled-sheets/{id}/runs": { parameters: [id], get: { ...operation("Read recorded runs in pages of 50, newest first then stable id; refresh page 1 for new executions", "200"),
    parameters: [{ in: "query", name: "page", required: false, schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }] },
    post: operation("Persist a manual request for the same autonomous, fenced worker", "201", { type: "object", required: ["expectedVersion"], properties: { expectedVersion: { type: "integer", minimum: 1 } } }) },
};
