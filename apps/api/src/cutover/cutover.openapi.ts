const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const uuid = { type: "string", format: "uuid" };
const instant = { type: "string", format: "date-time", description: "Original UTC instant with Z; local dates, modification dates and inferred offsets are refused" };
const request = { expectedVersion: { type: "integer", minimum: 1 }, idempotencyKey: { type: "string", maxLength: 128 } };
const reference = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });
const body = (name: string): unknown => ({ required: true, content: { "application/json": { schema: reference(name) } } });
const secured = { security: [{ bearerAuth: [] }] };
const id = { name: "id", in: "path", required: true, schema: uuid };
const responses = { "201": { description: "Durable authorized preparation or exact replay; never activates Sheets or imports Leads" },
  "400": { description: "Bounded identity/UTC/header input refused; no row-position fallback" }, "401": { description: "Expired/revoked session" },
  "403": { description: "Current role/campus/grants denied" }, "404": { description: "Target unavailable" },
  "409": { description: "Changed source binding/version/receipt or unresolved reconciliation" }, "503": { description: "Store unavailable; no effect claimed" } };
export const cutoverSchemas = {
  CutoverCreate: { type: "object", required: ["bootstrapPackageId", "connectorId", "t0", "timeZone", "excelFrozenAt", "originalArrivalColumn", "identityEvidenceSha256", "idempotencyKey"], properties: {
    bootstrapPackageId: uuid, connectorId: uuid, t0: instant, timeZone: { type: "string", description: "IANA zone, e.g. Africa/Casablanca; no fixed offset" }, excelFrozenAt: instant,
    originalArrivalColumn: { type: "string", maxLength: 200 }, identityEvidenceSha256: { ...sha, description: "Declared evidence reference only, not proof of upstream immutability or activation authority" }, idempotencyKey: request.idempotencyKey } },
  CutoverMutation: { type: "object", required: ["expectedVersion", "idempotencyKey"], properties: request },
  CutoverDecision: { type: "object", required: ["expectedVersion", "idempotencyKey", "sourceKey", "action", "reason"], properties: {
    ...request, sourceKey: sha, action: { type: "string", enum: ["KEEP_FOR_CATCHUP", "LINK_BASELINE"] }, reason: { type: "string", maxLength: 500 },
    targetBootstrapRowId: { ...uuid, description: "Required for LINK_BASELINE; accepted row in the same package with a currently readable Lead" } } },
  CutoverPause: { type: "object", required: ["expectedVersion", "idempotencyKey", "reason"], properties: { ...request, reason: { type: "string", maxLength: 500 } } },
};
export const cutoverPaths = {
  "/lead-import/cutover/manifests": { post: { ...secured, summary: "Bind sealed Excel, disabled source, immutable T0 and declared identity evidence", requestBody: body("CutoverCreate"), responses } },
  "/lead-import/cutover/manifests/{id}": { get: { ...secured, parameters: [id], summary: "Read private preparation ledger with payloads omitted and activation limitations explicit", responses: { "200": { description: "Current authorized manifest, bounded submissions and exclusive counts" }, ...Object.fromEntries(Object.entries(responses).filter(([code]) => code !== "201")) } } },
  "/lead-import/cutover/manifests/{id}/observe": { post: { ...secured, parameters: [id], summary: "Observe bounded source outside transaction; append durable inventory without Lead effects", requestBody: body("CutoverMutation"), responses } },
  "/lead-import/cutover/manifests/{id}/decisions": { post: { ...secured, parameters: [id], summary: "Resolve overlap explicitly; never auto-link by email/phone", requestBody: body("CutoverDecision"), responses } },
  "/lead-import/cutover/manifests/{id}/reconcile": { post: { ...secured, parameters: [id], summary: "Bind complete server bootstrap report; READY_FOR_CATCHUP is not activation", requestBody: body("CutoverMutation"), responses } },
  "/lead-import/cutover/manifests/{id}/suspend": { post: { ...secured, parameters: [id], summary: "Suspend preparation, retain ledger/receipts and all business history", requestBody: body("CutoverPause"), responses } },
  "/lead-import/cutover/manifests/{id}/resume": { post: { ...secured, parameters: [id], summary: "Explicit resume invalidates readiness; observation/reconciliation required again", requestBody: body("CutoverPause"), responses } },
};
