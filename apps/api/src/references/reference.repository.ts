import { ConflictException, HttpException, Inject, Injectable, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import type { CrmReference, Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";
import { referenceFields, referenceKey, type LeadReferenceValues, type ReferenceKind } from "./reference.contract.js";

export type ReferenceTransaction = Prisma.TransactionClient;
export function unknownReference(field: string): never { throw new UnprocessableEntityException({ code: "REFERENCE_VALUE_UNKNOWN", field }); }

/** Shared resolver used inside the same serializable transaction as lead/import writes. */
export async function resolveReference(tx: ReferenceTransaction, kind: ReferenceKind, raw: string, campusId?: string): Promise<CrmReference | undefined> {
  const rows = await tx.crmReferenceKey.findMany({ where: { kind, key: referenceKey(raw), scopeKey: { in: ["GLOBAL", ...(campusId ? [campusId] : [])] } }, include: { reference: true }, take: 2 });
  if (rows.length !== 1) return undefined; // Global/campus collision must be resolved explicitly, never guessed.
  return rows[0]?.reference;
}

export async function validateLeadReferences(tx: ReferenceTransaction, values: LeadReferenceValues, previous?: LeadReferenceValues): Promise<LeadReferenceValues> {
  const changed = (Object.keys(referenceFields) as Array<keyof LeadReferenceValues>).filter((key) => !previous || values[key] !== previous[key]);
  if (!changed.length) return values;
  const campus = await resolveReference(tx, "CAMPUS", values.campus);
  if (!campus) unknownReference("campus");
  if (changed.includes("campus") && campus.state !== "ACTIVE") unknownReference("campus");
  const result = { ...values };
  if (changed.includes("campus")) result.campus = campus.code;
  for (const field of ["program", "campaign"] as const) {
    if (!changed.includes(field) && !changed.includes("campus")) continue;
    const ref = await resolveReference(tx, referenceFields[field], values[field], campus.id);
    if (ref?.state !== "ACTIVE") unknownReference(field);
    if (field === "program") {
      const availability = await tx.crmProgramAvailability.findUnique({ where: { programId_campusId: { programId: ref.id, campusId: campus.id } } });
      if (!availability?.active) unknownReference(field);
    }
    result[field] = ref.code;
  }
  return result;
}

@Injectable()
export class ReferenceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  get client(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new ServiceUnavailableException({ code: "reference_store_unavailable" });
    return this.prisma.client;
  }
  async transaction<T>(action: (tx: ReferenceTransaction) => Promise<T>): Promise<T> {
    try { return await this.client.$transaction(action, { isolationLevel: "Serializable" }); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "P2002") throw new ConflictException({ code: "reference_canonical_conflict" });
      if (code === "P2034") throw new ConflictException({ code: "reference_concurrent_mutation" });
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: "reference_store_unavailable" });
    }
  }
}
