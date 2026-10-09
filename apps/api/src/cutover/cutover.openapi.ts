const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const uuid = { type: "string", format: "uuid" };
const instant = { type: "string", format: "date-time", description: "Original UTC instant with Z; local dates, modification dates and inferred offsets are refused" };
const request = { expectedVersion: { type: "integer", minimum: 1 }, idempotencyKey: { type: "string", maxLength: 128 } };
const reference = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });
const body = (name: string): unknown => ({ required: true, content: { "application/json": { schema: reference(name) } } });
const secured = { security: [{ bearerAuth: [] }] };
const id = { name: "id", in: "path", required: true, schema: uuid };
const responses = { "201": { description: "Durable authorized mutation or replay; manual consume and explicitly armed nonce-isolated synthetic worker can create NEW Leads. No real Google activation is available" },
  "400": { description: "Bounded identity/UTC/header input refused; no row-position fallback" }, "401": { description: "Expired/revoked session" },
  "403": { description: "Current role/campus/grants denied" }, "404": { description: "Target unavailable" },
  "409": { description: "Changed source binding/version/receipt or unresolved reconciliation" }, "503": { description: "Store unavailable; no effect claimed" } };
export const cutoverSchemas = {
  CutoverCreate: { type: "object", required: ["bootstrapPackageId", "connectorId", "sourceSheetId", "t0", "timeZone", "excelFrozenAt", "originalArrivalColumn", "identityEvidenceSha256", "idempotencyKey"], properties: {
    bootstrapPackageId: uuid, connectorId: uuid, t0: instant, timeZone: { type: "string", description: "IANA zone, e.g. Africa/Casablanca; no fixed offset" }, excelFrozenAt: { ...instant, description: "First lot requires final Excel freeze after delta to equal T0; unequal instants are refused, equality alone is not upstream attestation" },
    sourceSheetId: { type: "integer", minimum: 0, description: "Immutable numeric tab identity; Google reads recheck returned sheetId, not a row position or title" },
    originalArrivalColumn: { type: "string", maxLength: 200 }, identityEvidenceSha256: { ...sha, description: "Declared evidence reference only, not proof of upstream immutability or activation authority" }, idempotencyKey: request.idempotencyKey } },
  CutoverMutation: { type: "object", required: ["expectedVersion", "idempotencyKey"], properties: request },
  CutoverDecision: { type: "object", required: ["expectedVersion", "idempotencyKey", "sourceKey", "action", "reason"], properties: {
    ...request, sourceKey: sha, action: { type: "string", enum: ["KEEP_FOR_CATCHUP", "LINK_BASELINE"] }, reason: { type: "string", maxLength: 500 },
    targetBootstrapRowId: { ...uuid, description: "Required for LINK_BASELINE; accepted row in the same package with a currently readable Lead" } } },
  CutoverPause: { type: "object", required: ["expectedVersion", "idempotencyKey", "reason"], properties: { ...request, reason: { type: "string", maxLength: 500 } } },
  CutoverConsume: { type: "object", required: ["expectedVersion", "idempotencyKey", "limit", "confirmed"], properties: { ...request, limit: { type: "integer", minimum: 1, maximum: 25 }, confirmed: { const: true } } },
  CutoverRuntimeQualification: { type: "object", required: ["expectedVersion", "idempotencyKey"], description: "ADMIN/SUPER_ADMIN only. Provider-owned qualification requires the nonce-isolated synthetic database; a client hash/boolean cannot qualify Google, which remains PREPARATION_ONLY", properties: {
    ...request, expectedVersion: { ...request.expectedVersion, description: "Current manifest version, not runtime version" } } },
  CutoverRuntimeArm: { type: "object", required: ["expectedVersion", "idempotencyKey", "confirmed"], description: "ADMIN/SUPER_ADMIN only; creator and authorizer are persisted/revalidated. Both SHEETS_ENABLED and SHEET_CUTOVER_ENABLED must be literal true before worker claim/I/O/commit. No activation of the legacy connector", properties: {
    ...request, expectedVersion: { ...request.expectedVersion, description: "Current runtime version, not manifest version" }, confirmed: { const: true } } },
  CutoverCompensate: { type: "object", required: ["expectedVersion", "idempotencyKey", "sourceKey", "reason", "confirmed"], properties: {
    ...request, sourceKey: sha, reason: { type: "string", maxLength: 500 }, confirmed: { const: true } } },
};
export const cutoverPaths = {
  "/lead-import/cutover/context": { get: { ...secured, summary: "Current permitted campuses and connectors only; no nominal-role inference", responses: { "200": { description: "Bounded server-filtered context" }, "403": responses["403"] } } },
  "/lead-import/cutover/manifests": { post: { ...secured, summary: "Bind sealed Excel, disabled source, immutable T0 and declared identity evidence", requestBody: body("CutoverCreate"), responses } },
  "/lead-import/cutover/manifests/{id}": { get: { ...secured, parameters: [id], summary: "Read private preparation ledger with payloads omitted and activation limitations explicit", responses: { "200": { description: "Current authorized manifest, bounded submissions and exclusive counts" }, ...Object.fromEntries(Object.entries(responses).filter(([code]) => code !== "201")) } } },
  "/lead-import/cutover/manifests/{id}/observe": { post: { ...secured, parameters: [id], summary: "Observe bounded source outside transaction; append durable inventory without Lead effects", requestBody: body("CutoverMutation"), responses } },
  "/lead-import/cutover/manifests/{id}/decisions": { post: { ...secured, parameters: [id], summary: "Resolve overlap explicitly; never auto-link by email/phone", requestBody: body("CutoverDecision"), responses } },
  "/lead-import/cutover/manifests/{id}/reconcile": { post: { ...secured, parameters: [id], summary: "Bind complete server bootstrap report; READY_FOR_CATCHUP is not activation", requestBody: body("CutoverMutation"), responses } },
  "/lead-import/cutover/manifests/{id}/suspend": { post: { ...secured, parameters: [id], summary: "Suspend preparation, retain ledger/receipts and all business history", requestBody: body("CutoverPause"), responses } },
  "/lead-import/cutover/manifests/{id}/resume": { post: { ...secured, parameters: [id], summary: "Explicit resume invalidates readiness; observation/reconciliation required again", requestBody: body("CutoverPause"), responses } },
  "/lead-import/cutover/manifests/{id}/consume": { post: { ...secured, parameters: [id], summary: "Explicit bounded manual catch-up in NEW; LINK_BASELINE applies no Lead effects", requestBody: body("CutoverConsume"), responses } },
  "/lead-import/cutover/manifests/{id}/compensate": { post: { ...secured, parameters: [id], summary: "Compare downstream state, suspend and record request/refusal; NEVER claims effective withdrawal", requestBody: body("CutoverCompensate"), responses } },
  "/lead-import/cutover/manifests/{id}/runtime": { get: { ...secured, parameters: [id], summary: "ADMIN/SUPER_ADMIN: qualification, persisted delegation and fenced run state; Google PREPARATION_ONLY", responses: { "200": { description: "Current synthetic-only runtime or UNQUALIFIED; never attests real source semantics" }, ...Object.fromEntries(Object.entries(responses).filter(([code]) => code !== "201")) } } },
  "/lead-import/cutover/manifests/{id}/runtime/qualify": { post: { ...secured, parameters: [id], summary: "Prepare provider-owned SIMULATED_FIXTURE qualification only inside nonce-isolated test database; no client attestation", requestBody: body("CutoverRuntimeQualification"), responses } },
  "/lead-import/cutover/manifests/{id}/runtime/arm": { post: { ...secured, parameters: [id], summary: "Explicitly arm qualified synthetic runtime; not real Google activation and not legacy enabling", requestBody: body("CutoverRuntimeArm"), responses } },
  "/lead-import/cutover/manifests/{id}/runtime/disarm": { post: { ...secured, parameters: [id], summary: "Disarm/invalidate worker epoch; preserve all effects, business data and receipts", requestBody: body("CutoverRuntimeArm"), responses } },
};
