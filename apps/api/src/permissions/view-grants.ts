import type { Role } from "../auth/auth.types.js";

/** New capabilities never repurpose a lead-data permission to share an audience. */
export const viewGrantKeys = [
  "lead.views.view",
  "lead.views.share.team", "lead.views.share.campus", "lead.views.revoke.own",
  "lead.views.revoke.team", "lead.views.revoke.campus",
] as const;

export function viewDefaultScope(role: Role, key: string): "NONE" | "OWN" | "TEAM" | "CAMPUS" | "GLOBAL" | undefined {
  if (!(viewGrantKeys as readonly string[]).includes(key)) return undefined;
  if (key === "lead.views.view") return role === "SUPER_ADMIN" ? "GLOBAL" : "CAMPUS";
  if (role === "AUDITOR") return "NONE";
  if (role === "SUPER_ADMIN") return "GLOBAL";
  if (key === "lead.views.revoke.own") return "OWN";
  if (role === "ADMIN") return "CAMPUS";
  if (role === "MANAGER" && key.endsWith(".team")) return "TEAM";
  return "NONE";
}
