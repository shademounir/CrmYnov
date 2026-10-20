/** Server-derived read projections, never writable inputs or browser clocks. */
export const firstTreatmentSchemas = {
  LeadTreatmentProjection: {
    type: "object", readOnly: true,
    description: "Projection of the scoped Lead. First treatment is a recorded business interaction (including an exchange note, traced call, email, WhatsApp or meeting), not a read, login, import, source attachment or follow-up bookkeeping event. Known historical exchanges with an unknown date exclude the Lead from never-treated queues. Reception is persisted source evidence recognized by contract, otherwise persisted CRM creation/observation; imports and deployments never supply a new clock.",
    required: ["receivedAt", "receptionOrigin", "treatmentState", "hasUndatedHistory", "firstTreatmentPending", "firstTreatmentOverdue", "firstTreatmentAgeMinutes", "firstTreatmentDeadlineAt"],
    properties: {
      createdAt: { type: "string", format: "date-time", readOnly: true, description: "Immutable server-assigned CRM entry timestamp, distinct from source reception and last business treatment. Preserved on edit, reassignment and idempotent replay." },
      receivedAt: { type: "string", format: "date-time", readOnly: true, description: "First recognized WEB_FORM/FORMINATOR provenance bound to the immutable creation batch, otherwise persisted CRM observation. A later provenance attachment never replaces that clock. Historical BASELINE import observation is not the old prospect reception." },
      receptionOrigin: { type: "string", readOnly: true, enum: ["SOURCE_CONTRACT", "CRM_OBSERVATION", "CRM_OBSERVATION_BASELINE"] },
      firstTreatmentAt: { type: "string", format: "date-time", readOnly: true, description: "Earliest known effective dated business treatment; absent when no date is known, never fabricated." },
      lastTreatmentAt: { type: "string", format: "date-time", readOnly: true },
      treatmentState: { type: "string", readOnly: true, enum: ["DATED", "UNKNOWN_DATE", "NONE"] },
      hasUndatedHistory: { type: "boolean", readOnly: true },
      firstTreatmentPending: { type: "boolean", readOnly: true, description: "Open PROSPECT without known dated or undated business treatment." },
      firstTreatmentOverdue: { type: "boolean", readOnly: true, description: "Pending and strictly more than 24 consecutive elapsed hours after receivedAt; equality is not overdue. No automatic closure, call or message." },
      firstTreatmentAgeMinutes: { type: "integer", minimum: 0, nullable: true, readOnly: true, description: "Elapsed full minutes for pending Leads with a known reception; null for treated or unavailable evidence." },
      firstTreatmentDeadlineAt: { type: "string", format: "date-time", nullable: true, readOnly: true, description: "Reception plus exactly 24 consecutive hours; null when not pending or evidence unavailable." },
    },
  },
  FirstTreatmentQueue: {
    type: "object", additionalProperties: false, readOnly: true,
    required: ["count", "href", "thresholdHours", "comparison"],
    properties: {
      count: { type: "integer", minimum: 0, description: "Distinct authorized Leads in the same selected portfolio cohort, not actions. Zero remains a valid targeted queue." },
      href: { type: "string", pattern: "^/leads\\?", description: "Server-built FIRST_TREATMENT_OVERDUE link preserving compatible campus/adviser/source/status and exclusive cohort date bounds." },
      thresholdHours: { type: "integer", enum: [24] }, comparison: { type: "string", enum: ["STRICTLY_GREATER"] },
    },
  },
} as const;

export const treatmentListParameters = [
  { name: "acquisitionKind", in: "query", required: false, schema: { type: "string", enum: ["NEW", "BASELINE"] }, description: "NEW acquisition versus historical BASELINE reprise; intersected with every scope and filter, including MINE. NEW_RECEIVED view selects explicit NEW only and forces most-recent CRM entry first; urgent FOLLOW_UP remains oldest-due first." },
  { name: "inactiveTreatmentBefore", in: "query", required: false, schema: { type: "string", format: "date-time" }, description: "Frozen canonical UTC ISO instant including milliseconds. Selects only OPEN dossiers with entirely dated known business treatment strictly before this cutoff. Unknown/mixed history, never-treated and terminal dossiers excluded; technical lastActivityAt is not used. Same predicate as CommercialPerformance inactiveLeadCount." },
  { name: "portfolioState", in: "query", required: false, schema: { type: "string", enum: ["OPEN", "CLOSED"] }, description: "OPEN excludes ENROLLED/CLOSED_LOST. Intersected with every existing filter and authorization, never a grant." },
  { name: "view", in: "query", required: false, schema: { type: "string" }, description: "Includes TO_CONTACT, FIRST_TREATMENT_OVERDUE and NEXT_ACTION_MISSING; each uses the common server business rule and current authorized scope." },
  { name: "treatmentState", in: "query", required: false, schema: { type: "string", enum: ["DATED", "UNKNOWN_DATE", "NONE"] }, description: "Unknown historical treatment date is distinct from no treatment." },
  ...["treatmentFrom", "treatmentTo"].map((name) => ({ name, in: "query", required: false, schema: { type: "string", format: "date" }, description: "Inclusive business-treatment civil date in Africa/Casablanca, combinable with adviser, campus, status and source." })),
] as const;
