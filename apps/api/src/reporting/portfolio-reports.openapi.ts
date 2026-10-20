import { leadStatuses } from "../leads/lead.service.js";
import { leadTemperatures } from "../qualification/lead-qualification.service.js";
import { reportingChannels, reportingPeriods, reportingViews } from "./reporting-filter.js";

const count = { type: "integer", minimum: 0 } as const;
const instant = { type: "string", format: "date-time" } as const;
const rate = { type: "number", minimum: 0, maximum: 1, nullable: true, description: "Numerator / distinct current primary portfolio denominator; null when denominator is zero. Rounded to four decimals, not a percentage." } as const;
const counts = (keys: readonly string[]): object => ({ type: "object", required: keys, additionalProperties: false, properties: Object.fromEntries(keys.map(key => [key, count])) });
const ref = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });
const breakdown = { type: "array", items: { type: "object", required: ["value", "count"], properties: { value: { type: "string" }, count } } } as const;

export const portfolioReportParameters = [
  { name: "period", in: "query", schema: { type: "string", enum: reportingPeriods, default: "30d" }, description: "Creation cohort, not work performed during this period. custom requires from and to in normalized performance requests. No period=open on this endpoint." },
  ...["from", "to"].map(name => ({ name, in: "query", schema: { type: "string" }, description: name === "from" ? "Inclusive stored CRM creation boundary; date or ISO instant. Not historical prospect reception." : "Exclusive stored CRM creation boundary; date or ISO instant." })),
  ...["campus", "campaign", "program", "source", "adviserId"].map(name => ({ name, in: "query", schema: { type: "string", maxLength: 100 }, description: name === "adviserId" ? "Involved adviser: primary OR collaborator within the authorized cohort. Not task owner. Personal performance mode binds current account; no grant." : "Scoped cohort filter, canonical campus resolved by server. Never grants visibility." })),
  { name: "channel", in: "query", schema: { type: "string", enum: reportingChannels } },
  { name: "status", in: "query", schema: { type: "string", enum: leadStatuses }, description: "Current status of the selected portfolio, not a historical activity date." },
  { name: "view", in: "query", schema: { type: "string", enum: reportingViews }, description: "Performance personal mode binds adviser identity; global requires pilotage permission. Funnel requires pilotage permission even when a personal cohort is requested." },
  ...["treatmentFrom", "treatmentTo"].map(name => ({ name, in: "query", schema: { type: "string", format: "date" }, description: "Inclusive Africa/Casablanca calendar day of the last dated commercial treatment. Not lastActivityAt, import, reading or login." })),
  { name: "treatmentState", in: "query", schema: { type: "string", enum: ["DATED", "UNKNOWN_DATE", "NONE"] }, description: "Known undated/mixed history is not never-treated. Incompatible/invalid filters are refused, not silently widened." },
] as const;

export const portfolioReportSchemas = {
  AcquisitionPartition: { type: "object", required: ["definitionVersion", "newAcquisitionCount", "baselinePortfolioCount", "periodDateBasis"], properties: {
    definitionVersion: { type: "string", enum: ["acquisition-cohort-v1"] }, newAcquisitionCount: count, baselinePortfolioCount: count,
    periodDateBasis: { type: "string", enum: ["STORED_CREATED_AT_NOT_HISTORICAL_RECEPTION"] },
  } },
  AdviserPerformance: { type: "object", required: ["adviserId", "primaryLeadCount", "secondaryLeadCount", "acquisition", "statusVolumes", "rates", "medianMinutes", "followUps", "inactiveLeadCount", "activeLoad", "reassignments", "drillDown"], properties: {
    adviserId: { type: "string", description: "Current primary/secondary portfolio adviser or persisted visible task owner. Does not attribute historic work to the current assignee." }, adviserLabel: { type: "string", description: "Optional authorized label; missing is unavailable, never a fabricated name." },
    primaryLeadCount: count, secondaryLeadCount: { ...count, description: "Secondary contributions, never added to primary conversion attribution." }, acquisition: ref("AcquisitionPartition"),
    statusVolumes: { ...counts(["contacted", "qualified", "enrolled", "closedLost"]), description: "Contacted/qualified/enrolled reached from current state or observed status activities; closedLost is current CLOSED_LOST. Current CLOSED_LOST also counts contacted under the existing reached rule. This is portfolio stock, not today's work." },
    rates: { type: "object", required: ["contact", "qualification", "enrollment", "loss"], properties: Object.fromEntries(["contact", "qualification", "enrollment", "loss"].map(key => [key, rate])) },
    medianMinutes: { type: "object", required: ["firstHandling", "contactToQualification", "qualificationToEnrollment"], properties: Object.fromEntries(["firstHandling", "contactToQualification", "qualificationToEnrollment"].map(key => [key, { type: "number", minimum: 0, nullable: true, description: "Median observed minutes, null without observations. BASELINE import time is excluded as first reception; pre-import status transitions excluded from stage delays." }])) },
    followUps: { ...counts(["planned", "completed", "overdue", "cancelled", "active", "dueNow", "invalidDeadline"]), description: "ACTIONS by persisted task OWNER, even after Lead reassignment, intersected with the authorized Lead cohort. planned=future; overdue strictly dueAt<generatedAt; equality=dueNow. active=future+overdue+dueNow+invalidDeadline. Completed differs from cancelled; active tasks on terminal Leads excluded. Not distinct Leads." },
    inactiveLeadCount: { ...count, description: "Distinct OPEN current primary Leads whose entirely dated last business treatment is strictly before generatedAt-inactivityHours. Unknown/mixed history, never-treated, terminal and equality excluded; no technical activity clock." },
    activeLoad: { ...count, description: "Distinct non-terminal current primary portfolio Leads." },
    reassignments: { ...counts(["requested", "approved", "rejected"]), description: "REQUESTS made by this adviser within the visible cohort, not distinct Leads or automatic decisions." },
    drillDown: { type: "object", required: ["assigned", "overdue", "inactive"], properties: {
      assigned: { type: "string", description: "Lead list: primary intersection AND existing involved-adviser/cohort filters." },
      overdue: { type: "string", description: "commercial-work action queue with persisted taskOwnerId; itemCount counts actions, page.total distinct Leads." },
      inactive: { type: "string", description: "Lead list with OPEN and canonical frozen inactiveTreatmentBefore; same pure predicate as inactiveLeadCount." },
    } },
  } },
  CommercialPerformanceReport: { type: "object", required: ["definitionVersion", "timezone", "generatedAt", "cohort", "advisers", "acquisition", "definitions"], properties: {
    definitionVersion: { type: "string", enum: ["commercial-performance-v1"] }, timezone: { type: "string", enum: ["Africa/Casablanca"] }, generatedAt: instant,
    cohort: { type: "object", required: ["inactivityHours", "uniqueLeadCount"], properties: { from: instant, to: instant, inactivityHours: { type: "integer", minimum: 1, maximum: 2160 }, uniqueLeadCount: count } },
    advisers: { type: "array", items: ref("AdviserPerformance") }, acquisition: ref("AcquisitionPartition"),
    definitions: { type: "array", items: { type: "object", required: ["key", "numerator", "denominator", "inclusions", "exclusions"], properties: { key: { type: "string" }, numerator: { type: "string" }, denominator: { type: "string" }, inclusions: { type: "array", items: { type: "string" } }, exclusions: { type: "array", items: { type: "string" } } } } },
  } },
  CommercialFunnel: { type: "object", required: ["definitionVersion", "timezone", "generatedAt", "cohort", "currentState", "temperatureDistribution", "attainment", "firstTreatmentOverdue", "rates", "acquisition", "breakdowns", "definitions"], properties: {
    definitionVersion: { type: "string", enum: ["commercial-funnel-v1"] }, timezone: { type: "string", enum: ["Africa/Casablanca"] }, generatedAt: instant,
    cohort: { type: "object", required: ["totalUniqueLeads"], properties: { from: instant, to: instant, totalUniqueLeads: count } },
    currentState: counts(leadStatuses), temperatureDistribution: counts(leadTemperatures),
    attainment: { ...counts(["contactedOrBeyond", "qualifiedOrBeyond", "enrolled"]), description: "Current status sums only. enrolled===currentState.ENROLLED, not historical attainment; contactedOrBeyond=CONTACTED+QUALIFIED+ENROLLED." },
    firstTreatmentOverdue: ref("FirstTreatmentQueue"), rates: { type: "object", required: ["contactedOrBeyond", "qualifiedOrBeyond", "enrolled"], properties: Object.fromEntries(["contactedOrBeyond", "qualifiedOrBeyond", "enrolled"].map(key => [key, { ...rate, description: "Current attainment / totalUniqueLeads of selected cohort; null for empty cohort, four decimals." }])) },
    acquisition: { allOf: [ref("AcquisitionPartition"), { type: "object", required: ["currentNewEnrolledCount", "currentNewEnrollmentRate"], properties: { currentNewEnrolledCount: count, currentNewEnrollmentRate: { ...rate, description: "Current NEW enrolled / newAcquisitionCount, null for zero NEW denominator; BASELINE excluded." } } }] },
    breakdowns: { type: "object", required: ["campus", "campaign", "program", "source"], properties: Object.fromEntries(["campus", "campaign", "program", "source"].map(key => [key, breakdown])) },
    definitions: { type: "array", items: { type: "object", required: ["key", "formula", "denominator", "exclusions"], properties: { key: { type: "string" }, formula: { type: "string" }, denominator: { type: "string" }, exclusions: { type: "array", items: { type: "string" } } } } },
  } },
} as const;

const responses = (schema: string): object => ({
  "200": { description: "Authorized portfolio aggregates; no task notes, raw interaction text or decision evidence. Separate reads are not an atomic live snapshot.", content: { "application/json": { schema: ref(schema) } } },
  "400": { description: "Invalid/unknown filter or threshold, not an empty result" }, "401": { description: "Session required" }, "403": { description: "Resource/pilotage/current account scope refused; no role-based grant inferred" }, "503": { description: "Persistence/authorization unavailable; no fallback counts" },
});
export const portfolioReportPaths = {
  "/reports/commercial-performance": { get: { summary: "Read scoped current portfolios and separately owned action states", security: [{ bearerAuth: [] }],
    description: "Read-only authorized Lead creation cohort including labeled BASELINE. Current portfolio, historical attainment and persisted task ownership are explicitly different, not work performed today. Personal mode binds current account; global requires pilotage. No mutation, approval or notification activation.",
    parameters: [...portfolioReportParameters, { name: "inactivityHours", in: "query", schema: { type: "integer", minimum: 1, maximum: 2160, default: 72 } }], responses: responses("CommercialPerformanceReport") } },
  "/reports/commercial-funnel": { get: { summary: "Read current status and temperature partitions with strict first-treatment SLA", security: [{ bearerAuth: [] }],
    description: "Requires authorized pilotage scope. Explicit from/to select the Lead-created portfolio cohort; period alone does not derive boundaries in this endpoint. Current status sums, not historical event conversion. Unknown business history is not never-treated; strict >24h reception SLA, equality not overdue. No task notes or automatic business decisions.",
    parameters: portfolioReportParameters.filter(parameter => parameter.name !== "period"), responses: responses("CommercialFunnel") } },
} as const;
