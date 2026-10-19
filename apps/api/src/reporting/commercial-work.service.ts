import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { ClosureService } from "../closure/closure.service.js";
import { FollowUpService } from "../follow-up/follow-up.service.js";
import { LeadService, type LeadPage, type LeadReportingRow } from "../leads/lead.service.js";
import { firstTreatmentState } from "../leads/first-treatment.js";
import { matchesInteractiveFilters, reportingSearchParams, type InteractiveReportingQuery } from "./reporting-filter.js";
import { commercialWorkQueues, projectCommercialWork, type CommercialWorkQueue, type WorkProjection } from "./commercial-work.js";

export interface WorkQueueSummary {
  key: CommercialWorkQueue; label: string; leadCount: number; itemCount: number; itemUnit: "LEADS" | "ACTIONS" | "REQUESTS"; href: string;
  leadShare: { numerator: number; denominator: number; value: number | null };
}
export interface CommercialWorkReport {
  definitionVersion: "commercial-work-v1"; generatedAt: string; timezone: "Africa/Casablanca"; filters: InteractiveReportingQuery;
  cohort: { leadCount: number; attribution: "CURRENT_PRIMARY_ADVISER"; dateBasis: "LEAD_CREATED_COHORT_CURRENT_STATE"; from?: string; to?: string };
  queues: WorkQueueSummary[]; actions: WorkProjection["actions"];
  advisers: Array<{ adviserId: string; adviserLabel?: string; leadCount: number; queues: WorkQueueSummary[]; actions: WorkProjection["actions"] }>;
  selectedQueue: CommercialWorkQueue; page: LeadPage;
  definitions: string[];
}
export function workQueueKey(value = "TO_CONTACT"): CommercialWorkQueue {
  if (!Object.hasOwn(commercialWorkQueues, value)) throw new BadRequestException({ code: "commercial_work_queue_invalid" });
  return value as CommercialWorkQueue;
}
function pagination(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(number) || number < 1 || number > max) throw new BadRequestException({ code: "commercial_work_pagination_invalid" });
  return number;
}
function summaries(projection: WorkProjection, rows: readonly LeadReportingRow[], query: InteractiveReportingQuery): WorkQueueSummary[] {
  return (Object.keys(commercialWorkQueues) as CommercialWorkQueue[]).map((key) => {
    const queue = projection.queues[key], numerator = queue.leadIds.length, denominator = rows.length;
    const params = reportingSearchParams(query); params.set("queue", key);
    // Freeze a rolling cohort for the drilldown instead of moving its bounds
    // when the user opens the list a few seconds later.
    if (query.from && query.to) params.set("period", "custom");
    return { key, label: commercialWorkQueues[key], leadCount: numerator, itemCount: queue.itemCount, itemUnit: queue.itemUnit,
      href: `/manager/reports/commercial-work?${params.toString()}`, leadShare: { numerator, denominator, value: denominator ? numerator / denominator : null } };
  });
}

@Injectable()
export class CommercialWorkService {
  constructor(@Inject(LeadService) private readonly leads: LeadService, @Inject(FollowUpService) private readonly followUps: FollowUpService,
    @Inject(ClosureService) private readonly closures: ClosureService, @Inject(AuditService) private readonly audit: AuditService) {}

  read(query: InteractiveReportingQuery, selection: { queue?: string | undefined; page?: string | undefined; pageSize?: string | undefined }, principal: Principal, correlationId: string, now = new Date()): CommercialWorkReport {
    const queue = workQueueKey(selection.queue), page = pagination(selection.page, 1, 1_000_000), pageSize = pagination(selection.pageSize, 25, 100);
    const { adviserId, ...filters } = query;
    const rows = this.leads.reportingSnapshot(principal, now).filter((row) => matchesInteractiveFilters(row, filters) && (!adviserId || row.assignedToId === adviserId));
    const tasks = this.followUps.reportingSnapshot(principal), requests = this.closures.reportingSnapshot(principal);
    const projection = projectCommercialWork(rows, tasks, requests, now);
    const ids = projection.queues[queue].leadIds;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.slice((page - 1) * pageSize, page * pageSize).map((id) => {
      const lead = this.leads.getLead(id, principal, correlationId), row = byId.get(id)!;
      return { ...lead, ...firstTreatmentState(row, now) };
    });
    const advisers = [...new Set(rows.flatMap((row) => row.assignedToId ? [row.assignedToId] : []))].sort().map((id) => {
      const primary = rows.filter((row) => row.assignedToId === id), data = projectCommercialWork(primary, tasks, requests, now);
      const label = primary.find((row) => row.assignedToLabel)?.assignedToLabel;
      return { adviserId: id, ...(label ? { adviserLabel: label } : {}), leadCount: primary.length,
        queues: summaries(data, primary, { ...query, adviserId: id }), actions: data.actions };
    });
    this.audit.record({ eventType: "COMMERCIAL_WORK_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId,
      after: { queue, leadCount: rows.length, selectedCount: ids.length, page, pageSize }, result: "SUCCESS", idempotencyKey: `commercial-work:${randomUUID()}` });
    return { definitionVersion: "commercial-work-v1", generatedAt: now.toISOString(), timezone: "Africa/Casablanca", filters: query,
      cohort: { leadCount: rows.length, attribution: "CURRENT_PRIMARY_ADVISER", dateBasis: "LEAD_CREATED_COHORT_CURRENT_STATE", ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) },
      queues: summaries(projection, rows, query), actions: projection.actions, advisers, selectedQueue: queue, page: { items, page, pageSize, total: ids.length },
      definitions: [
        "Stock actuel des dossiers autorisés créés dans la période, pas un nombre de traitements réalisés aujourd’hui. Historique importé conservé, non attribué au travail contemporain.",
        "Filtre conseiller et tableaux : portefeuille principal actuel ; les contributions secondaires ne sont pas doublées. Dossiers non affectés inclus dans le total sans conseiller fictif.",
        "Relances : actions visibles rattachées au portefeuille, pas nécessairement réalisées par son conseiller actuel. Actives = SCHEDULED ou DUE sur dossier ouvert ; retard strictement après échéance. Égalité = échue maintenant, pas encore en retard.",
        "Réalisées et annulées sont des états distincts des tâches du portefeuille, sans attribution à une période de performance. Date invalide conservée dans les actives et signalée séparément.",
        "Part = leads distincts de la file / leads distincts de la cohorte affichée ; période from incluse/to exclue sur création. Dénominateur zéro : taux non calculable. Les files se recouvrent, leur somme n’est pas un total distinct.",
        "Clôtures : demandes finales en attente, pas approbations automatiques ni preuve d’un droit de décision. Les droits de demande et de décision restent contrôlés sur la fiche.",
      ] };
  }
}
