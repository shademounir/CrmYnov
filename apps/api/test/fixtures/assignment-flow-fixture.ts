import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Collaborator, CrmReference, Lead } from "@prisma/client";
import type { CreateLeadInput } from "../../src/leads/lead.service.js";
import type { Role } from "../../src/auth/auth.types.js";
import { deriveSecret } from "../../src/access-recovery/access-recovery.store.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { referenceKey } from "../../src/references/reference.contract.js";

export type AssignmentActor = Collaborator & { email: string; password: string };
export interface AssignmentFixture {
  prisma: PrismaService; db: NonNullable<PrismaService["client"]>; suffix: string;
  campus: CrmReference; otherCampus: CrmReference; program: CrmReference; campaign: CrmReference;
  commercial: AssignmentActor; target: AssignmentActor; secondTarget: AssignmentActor; firstLogin: AssignmentActor;
  manager: AssignmentActor; otherManager: AssignmentActor; admin: AssignmentActor; reader: AssignmentActor; outsider: AssignmentActor;
  key(label: string): string; leadInput(label: string): CreateLeadInput & { email: string; idempotencyKey: string }; ownedLead(label: string): Promise<Lead>;
}

/** Refuse every persistent preview/cloud URL before the first fixture write. */
export async function assignmentFlowFixture(): Promise<AssignmentFixture> {
  assert.equal(process.env.CRMY94_EPHEMERAL_TEST, "true");
  assert.equal(process.env.SHEETS_ENABLED, "false");
  assert.equal(process.env.CRM_BACKGROUND_WORKERS, "external");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/crmy94_assignment_synthetic");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.match(url.port, /^\d+$/u);
  const nonce = process.env.CRMY94_DATABASE_NONCE;
  assert.match(nonce ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  const prisma = new PrismaService();
  const db = prisma.client;
  assert.ok(db);
  assert.deepEqual(await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy94_test_identity.marker`, [{ nonce }]);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const reference = async (kind: "CAMPUS" | "PROGRAM" | "CAMPAIGN", label: string): Promise<CrmReference> => {
    const code = `ASG-${label}-${suffix}`;
    return db.crmReference.create({ data: { kind, code, label: `Synthetic ${label} ${suffix}`, scope: "GLOBAL", scopeKey: "GLOBAL", keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  };
  const campus = await reference("CAMPUS", "CAMPUS");
  const otherCampus = await reference("CAMPUS", "OTHER");
  const program = await reference("PROGRAM", "PROGRAM");
  const campaign = await reference("CAMPAIGN", "CAMPAIGN");
  await db.crmProgramAvailability.createMany({ data: [{ campusId: campus.id, programId: program.id }, { campusId: otherCampus.id, programId: program.id }] });
  const identity = async (role: Role, label: string, campusId = campus.id): Promise<AssignmentActor> => {
    const email = `${label}-${suffix.toLowerCase()}@example.invalid`;
    const password = randomBytes(24).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    const row = await db.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: `Synthetic ${label}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
    await db.localPasswordHash.create({ data: { collaboratorId: row.id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
    return { ...row, email, password };
  };
  const commercial = await identity("ADMISSIONS", "owner");
  const target = await identity("ADMISSIONS", "target");
  const secondTarget = await identity("ADMISSIONS", "second-target");
  const firstLogin = await identity("ADMISSIONS", "first-login");
  await db.collaborator.update({ where: { id: firstLogin.id }, data: { firstLoginRequired: true } });
  const manager = await identity("MANAGER", "manager");
  const otherManager = await identity("MANAGER", "second-manager");
  const admin = await identity("SUPER_ADMIN", "admin");
  const reader = await identity("AUDITOR", "reader");
  const outsider = await identity("ADMISSIONS", "outsider", otherCampus.id);
  const key = (label: string): string => `assignment-${suffix}-${label}`;
  const leadInput = (label: string): CreateLeadInput & { email: string; idempotencyKey: string } => ({ firstName: "Synthetic", lastName: `Assignment ${label}`, email: `${label}-${suffix.toLowerCase()}@lead.example.invalid`, campus: campus.code, campaign: campaign.code, program: program.code, educationLevel: "BAC", source: "PHONE_CALL", idempotencyKey: key(label) });
  const ownedLead = async (label: string): Promise<Lead> => {
    const input = leadInput(label);
    return db.lead.create({ data: { firstName: input.firstName, lastName: input.lastName, email: input.email, campus: input.campus, campaign: input.campaign, program: input.program, educationLevel: input.educationLevel, source: input.source, leadCode: `ASG-${suffix}-${label}`, assignedToId: commercial.id } });
  };
  return { prisma, db, suffix, campus, otherCampus, program, campaign, commercial, target, secondTarget, firstLogin, manager, otherManager, admin, reader, outsider, key, leadInput, ownedLead };
}
