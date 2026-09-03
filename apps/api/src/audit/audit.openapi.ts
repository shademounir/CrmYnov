const security = [{ bearerAuth: [] }];
const event = { type: "object", additionalProperties: false, properties: {
  id: { type: "string", format: "uuid" }, eventType: { type: "string" }, actorId: { type: "string", nullable: true }, actorRoles: { type: "array", items: { type: "string" } },
  campusId: { type: "string", nullable: true }, resourceType: { type: "string", nullable: true }, resourceId: { type: "string", nullable: true },
  occurredAt: { type: "string", format: "date-time" }, result: { type: "string" }, before: { type: "object" }, after: { type: "object" },
} };
const errors = { "400": { description: "Closed query contract violated" }, "401": { description: "Authentication required" }, "403": { description: "Eligible role AND effective audit.view required within all applicable ceilings" }, "503": { description: "Fail-closed database or authorization unavailable" } };
export const auditPaths = {
  "/audit-events": { get: { summary: "Search persistent append-only audit; each successful consultation is traced", security,
    parameters: ["from", "to", "snapshot", "actorId", "eventType", "resourceId", "resourceType", "result", "campus", "page", "pageSize"].map((name) => ({ name, in: "query", required: false, description: name === "from" || name === "to" || name === "snapshot" ? "UTC RFC3339 Z; display in Africa/Casablanca" : "Server-validated exact filter; pageSize 1–100, page 1–10000", schema: { type: "string" } })),
    responses: { ...errors, "200": { description: "Authorized rows only; stable occurredAt/id descending order, snapshot and server pagination", content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: event }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" }, snapshot: { type: "string", format: "date-time" }, timeZone: { type: "string", enum: ["Africa/Casablanca"] } } } } } } } } },
  "/audit-events/{id}": { get: { summary: "Read sanitized audit detail; no update/delete endpoint", security, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { ...errors, "404": { description: "Missing or outside authorized scope; indistinguishable" }, "200": { description: "Explicit safe fields only; no session, hash, token, IP or arbitrary metadata", content: { "application/json": { schema: event } } } } } },
};
