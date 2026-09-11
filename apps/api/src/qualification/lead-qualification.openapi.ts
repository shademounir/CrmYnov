export const leadQualificationPaths = {
  "/leads/{leadId}/qualification": {
    get: {
      summary: "Read the current manual commercial temperature and its append-only history",
      description: "Existing leads without a human qualification are returned as UNEVALUATED version 0.",
      responses: {
        "200": { description: "Current qualification and versioned history" },
        "403": { description: "lead.view or campus perimeter refused" },
      },
    },
    patch: {
      summary: "Append one manual commercial temperature qualification",
      description: "Requires the explicit lead.qualification.update grant. The mutation is independent from lead status, document state and contact result. Qualification and audit commit atomically; idempotent replay does not append another version.",
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false,
        required: ["temperature", "reason", "expectedVersion", "idempotencyKey"],
        properties: {
          temperature: { type: "string", enum: ["COLD", "WARM", "HOT"] },
          reason: { type: "string", minLength: 3, maxLength: 240 },
          comment: { type: "string", maxLength: 1000 },
          expectedVersion: { type: "integer", minimum: 0 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
        },
      } } } },
      responses: {
        "200": { description: "Qualification appended or exact replay returned" },
        "400": { description: "Unknown field, invalid temperature, reason or idempotency key" },
        "403": { description: "Explicit qualification grant, ownership/collaboration or campus perimeter refused" },
        "409": { description: "Optimistic concurrency or idempotency conflict; no partial qualification or audit" },
      },
    },
  },
} as const;
