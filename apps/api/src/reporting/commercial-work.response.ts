import { BadRequestException } from "@nestjs/common";
import type { CommercialWorkReport, WorkQueueSummary } from "./commercial-work.service.js";

export type WorkContractVersion = "1" | "2";
export type CommercialWorkResponse = Omit<CommercialWorkReport, "definitionVersion"> & { definitionVersion: "commercial-work-v1" | "commercial-work-v2" };
export function workContractVersion(raw = "1"): WorkContractVersion {
  if (raw !== "1" && raw !== "2") throw new BadRequestException({ code: "commercial_work_contract_version_invalid" });
  return raw;
}
/** Old loaded browsers keep six queues until they explicitly request v2. This
 * changes representation only, never the permission fence or selected cohort. */
export function workResponse(report: CommercialWorkReport, version: WorkContractVersion): CommercialWorkResponse {
  if (version === "1" && report.selectedQueue === "NEW_RECEIVED") throw new BadRequestException({ code: "commercial_work_queue_requires_v2" });
  const queues = (rows: WorkQueueSummary[]): WorkQueueSummary[] => rows.filter(row => version === "2" || row.key !== "NEW_RECEIVED").map(row => {
    const [path, search] = row.href.split("?"), params = new URLSearchParams(search);
    if (version === "2") params.set("contractVersion", "2");
    else params.delete("contractVersion");
    return { ...row, href: `${path}?${params}` };
  });
  return { ...report, definitionVersion: version === "2" ? "commercial-work-v2" : "commercial-work-v1",
    queues: queues(report.queues), advisers: report.advisers.map(adviser => ({ ...adviser, queues: queues(adviser.queues) })),
    definitions: version === "2" ? report.definitions : report.definitions.filter(definition => !definition.startsWith("Nouveaux reçus :")) };
}
