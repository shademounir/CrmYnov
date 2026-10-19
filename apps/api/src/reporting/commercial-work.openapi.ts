import { commercialWorkQueues } from "./commercial-work.js";

const integer = { type: "integer", minimum: 0 } as const;
const queueSchema = {
  type: "object", required: ["key", "label", "leadCount", "itemCount", "itemUnit", "href", "leadShare"],
  properties: {
    key: { type: "string", enum: Object.keys(commercialWorkQueues) }, label: { type: "string" },
    leadCount: { ...integer, description: "Distinct authorized Leads selected by the same projection as page.total, not task count." },
    itemCount: integer, itemUnit: { type: "string", enum: ["LEADS", "ACTIONS", "REQUESTS"] },
    href: { type: "string", pattern: "^/manager/reports/commercial-work\\?" },
    leadShare: { type: "object", required: ["numerator", "denominator", "value"], properties: { numerator: integer, denominator: integer, value: { type: "number", minimum: 0, maximum: 1, nullable: true, description: "numerator / denominator; null for zero denominator. Current stock of the Lead-created cohort, not contemporary performance." } } },
  },
};
export const commercialWorkPaths = { "/reports/commercial-work": { get: {
  summary: "Read six current commercial work queues and their exact scoped paginated Lead selection",
  description: "Primary current adviser attribution, not secondary contributions. Lead creation from inclusive/to exclusive defines the cohort. Counts/actions/outcomes are current stock, not work performed today. Overdue is strictly dueAt < generatedAt; equality is dueNow. Known undated historical business treatment is not never-treated. No automatic approval or business mutation.",
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: "queue", in: "query", schema: { type: "string", enum: Object.keys(commercialWorkQueues), default: "TO_CONTACT" } },
    { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 1_000_000, default: 1 } },
    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
    ...["period", "from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view"].map((name) => ({ name, in: "query", schema: { type: "string" }, description: "Shared scoped reporting filter. Personal mode binds adviserId to the current account; adviserId selects primary current ownership on this endpoint. Unknown fields refused." })),
  ],
  responses: { "200": { description: "Same authorized projection for all counters and selected page; compositional PostgreSQL read, not RepeatableRead. Lead items require reporting.view and lead.view, audit-scoped. No task notes or closure evidence exposed.", content: { "application/json": { schema: {
    type: "object", required: ["definitionVersion", "generatedAt", "timezone", "filters", "cohort", "queues", "actions", "advisers", "selectedQueue", "page", "definitions"],
    properties: {
      definitionVersion: { type: "string", enum: ["commercial-work-v1"] }, generatedAt: { type: "string", format: "date-time" }, timezone: { type: "string", enum: ["Africa/Casablanca"] }, filters: { type: "object" },
      cohort: { type: "object", properties: { leadCount: integer, attribution: { type: "string", enum: ["CURRENT_PRIMARY_ADVISER"] }, dateBasis: { type: "string", enum: ["LEAD_CREATED_COHORT_CURRENT_STATE"] }, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } } },
      queues: { type: "array", minItems: 6, maxItems: 6, items: queueSchema },
      actions: { type: "object", properties: Object.fromEntries(["active", "future", "dueNow", "overdue", "invalidDeadline", "completed", "cancelled"].map((key) => [key, integer])) },
      advisers: { type: "array", items: { type: "object", properties: { adviserId: { type: "string" }, adviserLabel: { type: "string" }, leadCount: integer, queues: { type: "array", minItems: 6, maxItems: 6, items: queueSchema }, actions: { type: "object", additionalProperties: integer } } } },
      selectedQueue: { type: "string", enum: Object.keys(commercialWorkQueues) },
      page: { type: "object", required: ["items", "page", "pageSize", "total"], properties: { items: { type: "array", maxItems: 100, items: { allOf: [{ $ref: "#/components/schemas/LeadTreatmentProjection" }, { type: "object", properties: { id: { type: "string" }, leadCode: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, status: { type: "string" }, assignedToLabel: { type: "string" }, hasActiveNextAction: { type: "boolean" } } }] } }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, total: integer } }, definitions: { type: "array", items: { type: "string" } },
    },
  } } } }, "400": { description: "Unknown/invalid filter, queue or pagination" }, "401": { description: "Session required" }, "403": { description: "Current scope or reporting/Lead permission refused" }, "503": { description: "Permission persistence unavailable; no role-based fallback" } },
} } } as const;
