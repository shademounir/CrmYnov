export const nextActionIntentSchema = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["mode", "dueAt", "reason"], properties: {
      mode: { type: "string", enum: ["SCHEDULE"] }, dueAt: { type: "string", format: "date-time" }, reason: { type: "string", minLength: 3, maxLength: 1000 },
    } },
    { type: "object", additionalProperties: false, required: ["mode", "id", "expectedVersion", "dueAt"], properties: {
      mode: { type: "string", enum: ["CONFIRM"] }, id: { type: "string", format: "uuid" }, expectedVersion: { type: "integer", minimum: 1 }, dueAt: { type: "string", format: "date-time" },
    } },
  ],
} as const;

export const manualInteractionSchema = {
  type: "object", additionalProperties: false, required: ["type", "result", "idempotencyKey"],
  description: "On an open Lead nextAction is mandatory: schedule the shared persistent follow-up or confirm its exact still-future version. On a closed Lead it is forbidden. The interaction, next action, projections, audit and receipts share one transaction. Technical/SDK events use their existing append-only routes and are never discarded for missing human planning.",
  properties: {
    type: { type: "string", enum: ["CRM_CALL", "EXTERNAL_CALL", "PHONE_CALL", "PHYSICAL_VISIT", "WHATSAPP", "MANUAL_EMAIL", "MEETING", "COMMENT"] },
    result: { type: "string", minLength: 1, maxLength: 1000 }, note: { type: "string", maxLength: 10000 },
    nextAction: nextActionIntentSchema, idempotencyKey: { type: "string", minLength: 8, maxLength: 64 },
  },
} as const;

export const followUpDecisionSchema = {
  type: "object", additionalProperties: false, required: ["action", "reason", "expectedVersion", "idempotencyKey"],
  description: "COMPLETE requires nextAction with mode SCHEDULE and commits the completed action and successor atomically. Cancellation is distinct from completion; final closure cancels obsolete actions without counting them as realized. POSTPONE changes the current action, never creates another one.",
  properties: {
    action: { type: "string", enum: ["POSTPONE", "COMPLETE", "CANCEL"] }, dueAt: { type: "string", format: "date-time" },
    reason: { type: "string", minLength: 1, maxLength: 1000 }, expectedVersion: { type: "integer", minimum: 1 },
    nextAction: nextActionIntentSchema, idempotencyKey: { type: "string", minLength: 8, maxLength: 64 },
  },
} as const;
