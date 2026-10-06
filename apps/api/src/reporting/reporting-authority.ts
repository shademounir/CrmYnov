import type { Principal } from "../auth/auth.types.js";

// This proof exists only for the current server-controlled read. It cannot be
// serialized into a session, forged in a DTO or retained after the fence exits.
const pilotageReads = new WeakSet<Principal>();
export function hasPilotageReportingScope(principal: Principal): boolean { return pilotageReads.has(principal) && principal.permissionLeadIds !== undefined; }
export async function withPilotageReportingScope<T>(principal: Principal, action: () => T | Promise<T>): Promise<T> {
  pilotageReads.add(principal);
  try { return await action(); } finally { pilotageReads.delete(principal); }
}
