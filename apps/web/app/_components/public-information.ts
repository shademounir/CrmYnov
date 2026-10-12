/** Exact public information pages only; never a prefix exemption for business/API routes. */
export const publicInformationPaths: ReadonlySet<string> = new Set(["/about", "/privacy", "/terms"]);
