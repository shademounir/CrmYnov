const failures = { "400": { description: "Invalid configuration or real source disabled" }, "401": { description: "Authenticated session required" },
  "403": { description: "Admin role, dynamic grant or campus ceiling refused" }, "409": { description: "Version, active run or automatic channel conflict" },
  "503": { description: "Source or persistent store unavailable; no unconfirmed success" } };
const id = { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } };
const mapping = { type: "object", required: ["mappingKey", "name", "profile", "columns"], properties: {
  mappingKey: { type: "string", pattern: "^[a-z][a-z0-9-]{2,63}$" }, name: { type: "string", maxLength: 100 }, profile: { type: "string", enum: ["FORMINATOR_ZAPIER", "CUSTOM"] },
  columns: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["sourceColumn", "action"], properties: {
    sourceColumn: { type: "string", maxLength: 200 }, targetField: { type: "string", enum: ["firstName", "lastName", "email", "phone", "educationLevel", "program", "campus", "campaign", "externalId", "historicalStatus", "occurredAt", "comment"] },
    action: { type: "string", enum: ["DIRECT", "TRIM", "LOWERCASE", "PHONE", "DATE", "METADATA", "IGNORE"] }, required: { type: "boolean" }, reason: { type: "string" },
  } } },
} };
export const sheetConfigurationSchema = { type: "object", required: ["expectedVersion", "enabled", "workbookLink", "tab", "campusId", "mapping", "context", "assignment"], properties: {
  expectedVersion: { type: "integer", minimum: 0 }, enabled: { type: "boolean", default: false }, intervalMinutes: { type: "integer", minimum: 5, maximum: 15, default: 15 },
  workbookLink: { type: "string", description: "Controlled docs.google.com spreadsheet link; GOOGLE requires exact server-side workbook/sheet/range authorization, never an arbitrary URL" },
  source: { type: "object", required: ["mode", "identityMode", "sheetId", "range"], additionalProperties: false, properties: {
    mode: { type: "string", enum: ["SIMULATED", "GOOGLE"], default: "SIMULATED" }, identityMode: { type: "string", enum: ["EXTERNAL_ID", "LOCAL_ROW"], default: "EXTERNAL_ID" },
    sheetId: { type: "integer", minimum: 0 }, range: { type: "string", description: "Bounded A1 range including headers; no automatic expansion" },
  }, description: "Omitted only for legacy simulated external-ID configurations. LOCAL_ROW requires CUSTOM mapping and explicitly declared originalSource; detected source changes suspend processing for reconciliation." },
  tab: { type: "string", maxLength: 100 }, campusId: { type: "string", description: "Server-resolved canonical campus UUID or code" }, mapping,
  context: { type: "object", required: ["source", "technicalSystem", "campus", "campaign"], properties: { source: { type: "string", enum: ["WEB_FORM", "PHONE_CALL", "PHYSICAL_VISIT", "WEBSITE", "EVENT", "PARTNER", "JOBINTECH", "LEGACY_IMPORT", "MANUAL_ENTRY", "OTHER_CONTROLLED"] },
    technicalSystem: { type: "string", enum: ["FORMINATOR_ZAPIER", "GOOGLE_SHEETS_LOCAL"] }, originalSource: { type: "string", minLength: 1, maxLength: 120, description: "Required for LOCAL_ROW; declared by the operator, never inferred as Forminator" }, campus: { type: "string" }, campaign: { type: "string" }, program: { type: "string" }, educationLevel: { type: "string" } } },
  assignment: { type: "object", required: ["strategy"], properties: { strategy: { type: "string", enum: ["UNASSIGNED", "FIXED", "ROUND_ROBIN", "CONTROLLED_RANDOM"] }, targetUserId: { type: "string", format: "uuid" } } },
} };
function operation(summary: string, status: string, schema?: object): object {
  return { summary, security: [{ bearerAuth: [] }], ...(schema ? { requestBody: { required: true, content: { "application/json": { schema } } } } : {}),
    responses: { [status]: { description: "Current scoped result; configuration version is optimistic and run snapshots are immutable" }, ...failures } };
}
export const sheetImportPaths = {
  "/scheduled-sheets": { get: { ...operation("List campus configurations and canonical mapping templates; googleReady reports server transport availability, not proof of workbook access", "200"),
    parameters: [{ in: "query", name: "campus", required: true, schema: { type: "string" } }] }, post: operation("Create a persistent versioned connector (disabled by default)", "201", sheetConfigurationSchema) },
  "/scheduled-sheets/{id}": { parameters: [id], put: operation("Save a new immutable configuration revision; enforce a single automatic channel", "200", sheetConfigurationSchema) },
  "/scheduled-sheets/{id}/simulations": { parameters: [id], post: operation("Read the configured source outside transactions and reauthorize/version-check before validation. No Lead, ledger, cursor or audit writes. LOCAL_ROW compares persisted observation; reconciliationRequired=true and reason force mapped=0. Unknown references count as review, while access/technical errors propagate. GOOGLE errors never fall back to simulation.", "201") },
  "/scheduled-sheets/{id}/reconciliation": { parameters: [id], get: { ...operation("Read scoped local-row reconciliation metadata without prospect contents; no mutation or automatic resolution", "200"),
    parameters: [{ in: "query", name: "page", required: false, schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }] } },
  "/scheduled-sheets/{id}/runs": { parameters: [id], get: { ...operation("Read recorded runs in pages of 50, newest first then stable id; refresh page 1 for new executions", "200"),
    parameters: [{ in: "query", name: "page", required: false, schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }] },
    post: operation("Persist a manual request for the same autonomous, fenced worker. LOCAL_ROW permits a controlled manual run while automatic imports remain disabled; source credentials, scope and version checks remain mandatory. EXTERNAL_ID still requires an enabled connector. This operation never enables automatic scheduling.", "201", { type: "object", required: ["expectedVersion"], properties: { expectedVersion: { type: "integer", minimum: 1 } } }) },
};
