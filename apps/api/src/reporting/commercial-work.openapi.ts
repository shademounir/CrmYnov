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
    subsetRate: { type: "object", required: ["numerator", "denominator", "value", "unit", "denominatorQueue", "label"], description: "FIRST_TREATMENT_OVERDUE Leads / TO_CONTACT Leads; OVERDUE_FOLLOW_UP actions / ACTIVE_FOLLOW_UP actions. Not a rate of distinct Leads for action counts.", properties: { numerator: integer, denominator: integer, value: { type: "number", minimum: 0, maximum: 1, nullable: true }, unit: { type: "string", enum: ["LEADS", "ACTIONS"] }, denominatorQueue: { type: "string", enum: ["TO_CONTACT", "ACTIVE_FOLLOW_UP"] }, label: { type: "string" } } },
  },
};
export const commercialWorkPaths = { "/reports/commercial-work": { get: {
  summary: "Read new acquisitions and six commercial work queues with exact scoped paginated Lead selection and explicit subset rates",
  description: "Explicit PRIMARY or INVOLVED adviser attribution; sub-tables remain primary. Lead creation from inclusive/to exclusive defines the cohort. Counts/actions/outcomes are current stock, not work performed today. Overdue is strictly dueAt < generatedAt; equality is dueNow. Known undated historical business treatment is not never-treated. No automatic approval or business mutation.",
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: "contractVersion", in: "query", schema: { type: "string", enum: ["1", "2"], default: "1" }, description: "Legacy loaded clients keep six v1 queues by default. Explicit v2 returns seven queues including NEW_RECEIVED and all drilldowns retain contractVersion=2. No authorization change." },
    { name: "queue", in: "query", schema: { type: "string", enum: Object.keys(commercialWorkQueues), default: "TO_CONTACT" } },
    { name: "adviserScope", in: "query", schema: { type: "string", enum: ["PRIMARY", "INVOLVED"], default: "PRIMARY" }, description: "INVOLVED preserves older cohort filters including collaborators, after the same permission fence. Never grants access." },
    { name: "taskOwnerId", in: "query", schema: { type: "string", maxLength: 100 }, description: "Optional persisted task OWNER filter, independent of Lead adviserId. Only action states and follow-up queues are filtered. Same authorized Lead cohort; personal mode permits only the current account. Does not grant access or reattribute work." },
    { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 1_000_000, default: 1 } },
    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
    ...["period", "from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view", "treatmentFrom", "treatmentTo", "treatmentState"].map((name) => ({ name, in: "query", schema: { type: "string" }, description: "Shared scoped reporting filter. treatmentFrom/To are inclusive YYYY-MM-DD Casablanca days on the last dated commercial treatment, not imports; treatmentState DATED/UNKNOWN_DATE/NONE preserves undated history. Personal mode binds adviserId to current account. period=open preserves unbounded or one-sided older cohorts, without invented date bounds. Unknown fields refused." })),
  ],
  responses: { "200": { description: "Same authorized projection for all counters and selected page; compositional PostgreSQL read, not RepeatableRead. Lead items require reporting.view and lead.view, audit-scoped. No task notes or closure evidence exposed.", content: { "application/json": { schema: {
    type: "object", required: ["definitionVersion", "generatedAt", "timezone", "filters", "cohort", "queues", "actions", "advisers", "selectedQueue", "page", "definitions"],
    properties: {
      definitionVersion: { type: "string", enum: ["commercial-work-v1", "commercial-work-v2"] }, generatedAt: { type: "string", format: "date-time" }, timezone: { type: "string", enum: ["Africa/Casablanca"] }, filters: { type: "object" },
      taskOwnerId: { type: "string", description: "Active task-owner restriction; absent means all visible task owners in the cohort." },
      cohort: { type: "object", properties: { leadCount: integer, attribution: { type: "string", enum: ["CURRENT_PRIMARY_ADVISER", "INVOLVED_ADVISER"] }, dateBasis: { type: "string", enum: ["LEAD_CREATED_COHORT_CURRENT_STATE"] }, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } } },
      queues: { type: "array", minItems: 6, maxItems: 7, items: queueSchema, description: "Exactly six for v1, seven for explicit v2; never a partial projection." },
      actions: { type: "object", properties: Object.fromEntries(["active", "future", "dueNow", "overdue", "invalidDeadline", "completed", "cancelled"].map((key) => [key, integer])) },
      advisers: { type: "array", items: { type: "object", properties: { adviserId: { type: "string" }, adviserLabel: { type: "string" }, leadCount: integer, queues: { type: "array", minItems: 6, maxItems: 7, items: queueSchema }, actions: { type: "object", additionalProperties: integer } } } },
      selectedQueue: { type: "string", enum: Object.keys(commercialWorkQueues) },
      page: { type: "object", required: ["items", "page", "pageSize", "total"], properties: { items: { type: "array", maxItems: 100, items: { allOf: [{ $ref: "#/components/schemas/LeadTreatmentProjection" }, { type: "object", properties: { id: { type: "string" }, leadCode: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, status: { type: "string" }, assignedToLabel: { type: "string" }, hasActiveNextAction: { type: "boolean" } } }] } }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, total: integer } }, definitions: { type: "array", items: { type: "string" } },
    },
  } } } }, "400": { description: "Unknown/invalid filter, queue or pagination" }, "401": { description: "Session required" }, "403": { description: "Current scope or reporting/Lead permission refused" }, "503": { description: "Permission persistence unavailable; no role-based fallback" } },
} } } as const;
