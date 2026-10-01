export const createCollaboratorBody = {
  required: true, content: { "application/json": { schema: { type: "object", required: ["professionalEmail", "roles"], properties: {
    professionalEmail: { type: "string", format: "email" }, secondaryEmail: { type: "string", format: "email" },
    roles: { type: "array", items: { type: "string", enum: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"] } },
    campusId: { type: "string" }, teamId: { type: "string" },
    professionalDisplayName: { type: "string", nullable: true, maxLength: 120, writeOnly: true, description: "Optional professional name; trim whitespace, empty becomes NULL, reject controls. Never derived from email. Not returned in user responses." },
  } } } },
};
