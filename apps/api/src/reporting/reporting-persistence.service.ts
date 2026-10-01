import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { ReassignmentService } from "../assignment/reassignment.service.js";
import { LeadService } from "../leads/lead.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { InteractiveReportingQuery } from "./reporting-filter.js";

export interface PersistentReportingEvidence {
  source: "POSTGRESQL" | "LOCAL_SYNTHETIC_FALLBACK";
  distinctLeadCount: number;
  appointmentCount: number;
  documentMetadataCount: number;
  importBatchCount: number;
}

@Injectable()
export class ReportingPersistenceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(ReassignmentService) private readonly reassignments: ReassignmentService,
  ) {}

  async refresh(): Promise<void> {
    await Promise.all([
      this.leads.refreshReportingForApi(),
      this.reassignments.refreshReportingForApi(),
    ]);
  }

  async evidence(principal: Principal, query: InteractiveReportingQuery): Promise<PersistentReportingEvidence> {
    const client = this.prisma.client;
    if (!client) {
      return { source: "LOCAL_SYNTHETIC_FALLBACK", distinctLeadCount: 0, appointmentCount: 0, documentMetadataCount: 0, importBatchCount: 0 };
    }
    const leadWhere = this.leadScope(principal, query);
    const [distinctLeadCount, appointmentCount, documentMetadataCount, importBatchCount] = await client.$transaction([
      client.lead.count({ where: leadWhere }),
      client.appointment.count({ where: { lead: leadWhere } }),
      client.candidateDocument.count({ where: { lead: leadWhere } }),
      client.ingestionBatch.count({ where: this.batchPeriod(query) }),
    ]);
    return { source: "POSTGRESQL", distinctLeadCount, appointmentCount, documentMetadataCount, importBatchCount };
  }

  private leadScope(principal: Principal, query: InteractiveReportingQuery): Prisma.LeadWhereInput {
    const global = principal.scopes.some((scope) => scope.kind === "GLOBAL");
    const allowedCampuses = principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []);
    return {
      ...(!global ? { campus: { in: allowedCampuses } } : {}),
      ...(query.campus ? { campus: query.campus } : {}),
      ...(query.campaign ? { campaign: query.campaign } : {}),
      ...(query.program ? { program: query.program } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.adviserId ? { OR: [{ assignedToId: query.adviserId }, { collaborators: { some: { userId: query.adviserId, active: true } } }] } : {}),
      createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) },
    };
  }

  private batchPeriod(query: InteractiveReportingQuery): Prisma.IngestionBatchWhereInput {
    return { importedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } };
  }
}
