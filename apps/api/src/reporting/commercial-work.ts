import type { ClosureRequest } from "../closure/closure.service.js";
import type { FollowUpRecord } from "../follow-up/follow-up.service.js";
import type { LeadReportingRow } from "../leads/lead.service.js";
import { firstTreatmentState } from "../leads/first-treatment.js";
import { isToContact } from "../leads/lead-treatment.js";
import { needsNextAction } from "../follow-up/next-action.contract.js";

export const commercialWorkQueues = {
  TO_CONTACT: "À contacter", FIRST_TREATMENT_OVERDUE: "Premiers traitements en retard",
  ACTIVE_FOLLOW_UP: "Relances en attente", OVERDUE_FOLLOW_UP: "Relances en retard",
  NEXT_ACTION_MISSING: "Prochaine action à planifier", PENDING_CLOSURE: "Clôtures en attente de décision",
} as const;
export type CommercialWorkQueue = keyof typeof commercialWorkQueues;
export interface WorkSelection { leadIds: string[]; itemCount: number; itemUnit: "LEADS" | "ACTIONS" | "REQUESTS" }
export interface WorkProjection {
  queues: Record<CommercialWorkQueue, WorkSelection>;
  actions: { active: number; future: number; dueNow: number; overdue: number; invalidDeadline: number; completed: number; cancelled: number };
}
const open = (lead: LeadReportingRow): boolean => !["ENROLLED", "CLOSED_LOST"].includes(lead.status);

/** One pure projection drives both counters and their paginated Lead selection.
 * Rows/tasks/requests have already passed the current account's visibility fence. */
export function projectCommercialWork(rows: readonly LeadReportingRow[], tasks: readonly FollowUpRecord[], requests: readonly ClosureRequest[], now: Date): WorkProjection {
  const leads = new Map(rows.map((row) => [row.id, row]));
  const visibleTasks = [...new Map(tasks.filter((task) => leads.has(task.leadId)).map((task) => [task.id, task])).values()];
  const active = visibleTasks.filter((task) => ["SCHEDULED", "DUE"].includes(task.state) && open(leads.get(task.leadId)!));
  const overdue = active.filter((task) => Date.parse(task.dueAt) < now.valueOf());
  const pending = [...new Map(requests.filter((request) => request.state === "PENDING" && ["ENROLLED", "CLOSED_LOST"].includes(request.target) && leads.has(request.leadId) && open(leads.get(request.leadId)!)).map((request) => [request.id, request])).values()];
  const leadSelection = (predicate: (row: LeadReportingRow) => boolean): WorkSelection => {
    const leadIds = [...leads.values()].filter(predicate).map((row) => row.id).sort();
    return { leadIds, itemCount: leadIds.length, itemUnit: "LEADS" };
  };
  const items = (records: readonly { leadId: string }[], itemUnit: "ACTIONS" | "REQUESTS"): WorkSelection => ({ leadIds: [...new Set(records.map((record) => record.leadId))].sort(), itemCount: records.length, itemUnit });
  return { queues: {
    TO_CONTACT: leadSelection(isToContact), FIRST_TREATMENT_OVERDUE: leadSelection((lead) => firstTreatmentState(lead, now).firstTreatmentOverdue),
    ACTIVE_FOLLOW_UP: items(active, "ACTIONS"), OVERDUE_FOLLOW_UP: items(overdue, "ACTIONS"),
    NEXT_ACTION_MISSING: leadSelection(needsNextAction), PENDING_CLOSURE: items(pending, "REQUESTS"),
  }, actions: {
    active: active.length, future: active.filter((task) => Date.parse(task.dueAt) > now.valueOf()).length,
    dueNow: active.filter((task) => Date.parse(task.dueAt) === now.valueOf()).length, overdue: overdue.length,
    invalidDeadline: active.filter((task) => !Number.isFinite(Date.parse(task.dueAt))).length,
    completed: visibleTasks.filter((task) => task.state === "COMPLETED").length,
    cancelled: visibleTasks.filter((task) => task.state === "CANCELLED").length,
  } };
}
