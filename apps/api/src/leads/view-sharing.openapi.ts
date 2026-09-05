const uuid = { type: "string", format: "uuid" };
const version = { type: "integer", minimum: 1 };
export const viewDetailsSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "name", "filters", "version", "owned", "isOwner", "ownerDisplayName", "visibleAudiences", "canEdit", "canRevoke", "canDuplicate"],
  properties: {
    id: uuid, name: { type: "string" }, version, filters: { type: "object", additionalProperties: { type: "string" } },
    owned: { type: "boolean", description: "Legacy alias of isOwner" }, isOwner: { type: "boolean", readOnly: true },
    ownerDisplayName: { type: "string", maxLength: 120, readOnly: true, description: "Authorized professional name only; otherwise Utilisateur indisponible. Never a login identifier." },
    visibleAudiences: { type: "array", readOnly: true, items: { type: "object", additionalProperties: false, required: ["type", "label"], properties: { type: { type: "string", enum: ["TEAM", "CAMPUS"] }, label: { type: "string" } } } },
    canEdit: { type: "boolean", readOnly: true }, canRevoke: { type: "boolean", readOnly: true }, canDuplicate: { type: "boolean", readOnly: true },
  },
};
const command = { expectedVersion: version, idempotencyKey: { type: "string", pattern: "^[a-zA-Z0-9_-]{8,64}$" } };
const parameters = [{ in: "path", name: "id", required: true, schema: uuid }];
const failures = {
  "400": { description: "Invalid or unknown input field" }, "401": { description: "Authentication required" },
  "403": { description: "Role, grant or effective scope refused" }, "404": { description: "View or audience unavailable without cross-campus disclosure" },
  "409": { description: "Optimistic version, idempotency or concurrent mutation conflict; reload before confirming" },
  "503": { description: "Store unavailable; business write and audit rolled back atomically" },
};
function mutation(summary: string, properties: object, required: string[]): object {
  return { summary, parameters, security: [{ bearerAuth: [] }],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expectedVersion", "idempotencyKey", ...required], properties: { ...command, ...properties } } } } },
    responses: { "201": { description: "Versioned result; identical idempotent replay does not duplicate the audit" }, ...failures } };
}
function read(summary: string, schema?: object): object { return { summary, security: [{ bearerAuth: [] }], responses: { "200": { description: "Current authorized result; Cache-Control: no-store", ...(schema ? { content: { "application/json": { schema } } } : {}) }, ...failures } }; }
export const viewSharingPaths = {
  "/view-sharing/audiences": { get: read("List only server-resolved canonical campus/team audiences permitted by current grants") },
  "/view-sharing/received": { get: read("List unique accessible views with only visible active audiences and server-evaluated capabilities", { type: "array", items: viewDetailsSchema }) },
  "/view-sharing/history": { get: read("List retained sharing metadata and current revocation capability; no filter contents") },
  "/view-sharing/views/{id}": { get: { ...read("Read the current shared definition; revoked or archived old links are unavailable", viewDetailsSchema), parameters } },
  "/view-sharing/views/{id}/shares": { post: mutation("Share an owned view with a governed TEAM or CAMPUS", { kind: { type: "string", enum: ["TEAM", "CAMPUS"] }, audienceId: uuid }, ["kind", "audienceId"]) },
  "/view-sharing/shares/{id}/revoke": { post: mutation("Immediately revoke as owner, responsible Manager or scoped administrator; preserve history", {}, []) },
  "/view-sharing/views/{id}/duplicate": { post: mutation("Duplicate an accessible definition as an independently owned private view", { name: { type: "string", minLength: 1, maxLength: 80 } }, ["name"]) },
  "/view-sharing/views/{id}/archive": { post: mutation("Archive an owned view and make all its shares unusable without deleting history", {}, []) },
};
