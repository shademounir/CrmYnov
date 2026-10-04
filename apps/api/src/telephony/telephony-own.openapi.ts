const versionBody = { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expectedVersion"], properties: { expectedVersion: { type: "integer", minimum: 1 } } } } } };
const refusals = { "400": { description: "Unexpected field, identifier or version refused" }, "401": { description: "Active authenticated session required" }, "403": { description: "Current role, own campus or effective capability refused" }, "409": { description: "Stale version, active call, inactive profile or existing workstation" }, "503": { description: "PostgreSQL persistence unavailable; no in-memory fallback" } };
export const ownTelephonyPaths = {
  "/telephony/me": { get: {
    summary: "Read the authenticated user's own telephony state without administrative configuration or secrets",
    description: "Identity and campus are server-derived. The strict DTO includes only the assigned extension, minimal workstation, observed freshness/readiness and current self-service capabilities. SIP credentials, server addresses, tokens, digests and raw device identifiers are omitted. Local audio and startup preferences remain in the Windows agent.",
    responses: { "200": { description: "Private no-store own-account state; an unassigned profile is null, never auto-provisioned" }, ...refusals },
  } },
  "/telephony/me/pairing-codes": { post: {
    summary: "Explicitly issue one expiring, one-use association code for the already provisioned own profile",
    description: "Requires interaction.create; no userId, campus or SIP data is accepted. Codes expire after 10 minutes; generating a replacement expires previous unused codes. The raw credential is returned only once with no-store and must never enter URLs, logs or browser persistence. An active workstation or unresolved call prevents issuance.",
    requestBody: versionBody, responses: { "201": { description: "Ephemeral code, expiresAt, profileId and updated profile version" }, ...refusals },
  } },
  "/telephony/me/workstations/{workstationId}/revoke": { patch: {
    summary: "Revoke only the authenticated user's workstation CRM credential, without deleting its protected local profile",
    description: "Requires interaction.create and the workstation version. Active or uncertain nonterminal calls prevent revocation. A repeat of the exact revoked generation creates no additional audit. This is not SIP/PBX revocation: stop the old Windows agent before associating another workstation.",
    parameters: [{ name: "workstationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
    requestBody: versionBody, responses: { "200": { description: "Reloaded private no-store own-account state" }, "404": { description: "Workstation unavailable in the caller's own profile" }, ...refusals },
  } },
};
