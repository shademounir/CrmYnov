/** Server-created metadata only; never accepted from an HTTP payload. */
export interface AssignmentAudit {
  origin: "AUTOMATIC" | "MANUAL";
  decisionRef: string;
  configurationVersion: number | null;
  ruleId: string | null;
  requestHash: string;
  selectedUserId: string;
}
