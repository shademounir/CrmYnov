import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Role } from "../../src/auth/auth.types.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { deriveSecret } from "../../src/access-recovery/access-recovery.store.js";
import type { Collaborator, CrmReference, TelephonyServerProfile, TelephonyUserProfile } from "@prisma/client";

type SyntheticActor = Collaborator & { email: string; password: string };
interface OwnFixture {
  prisma: PrismaService; db: NonNullable<PrismaService["client"]>; suffix: string; firstCampus: CrmReference; otherCampus: CrmReference;
  commercial: SyntheticActor; manager: SyntheticActor; reader: SyntheticActor; outsider: SyntheticActor;
  server: TelephonyServerProfile; profile: TelephonyUserProfile; managerProfile: TelephonyUserProfile;
}

/** Never targets an existing preview, DEV or production; fixtures use only .invalid identities. */
export async function ownTelephonyFixture(): Promise<OwnFixture> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/crmy171_synthetic");
  const nonce = process.env.CRMY171_DATABASE_NONCE;
  assert.match(nonce ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  const prisma = new PrismaService(); const db = prisma.client; assert.ok(db);
  assert.deepEqual(await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy171_test_identity.marker`, [{ nonce }]);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const campus = async (prefix: string): Promise<CrmReference> => db.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code: `${prefix}-${suffix}`, label: `Synthetic ${prefix} ${suffix}`, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: `${prefix}-${suffix}` } } } });
  const firstCampus = await campus("TEL"); const otherCampus = await campus("OTHER");
  const identity = async (role: Role, label: string, campusId = firstCampus.id): Promise<SyntheticActor> => {
    const email = `${label}-${suffix.toLowerCase()}@example.invalid`; const password = randomBytes(24).toString("base64url"); const salt = randomBytes(16).toString("hex");
    const row = await db.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: `Synthetic ${label}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
    await db.localPasswordHash.create({ data: { collaboratorId: row.id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
    return { ...row, email, password };
  };
  const commercial = await identity("ADMISSIONS", "commercial"); const manager = await identity("MANAGER", "manager");
  const reader = await identity("AUDITOR", "reader"); const outsider = await identity("ADMISSIONS", "outsider", otherCampus.id);
  const server = await db.telephonyServerProfile.create({ data: { name: `Synthetic SIP ${suffix}`, sipDomain: "sip.example.invalid", proxyUri: "sip:proxy.example.invalid", campusId: firstCampus.id, enabled: true, createdBy: manager.id, updatedBy: manager.id } });
  const profile = await db.telephonyUserProfile.create({ data: { userId: commercial.id, serverProfileId: server.id, sipAddress: "sip:211@sip.example.invalid", authUsername: "private-auth-username", enabled: true, state: "PAIRING_REQUIRED", updatedBy: manager.id } });
  const managerProfile = await db.telephonyUserProfile.create({ data: { userId: manager.id, serverProfileId: server.id, sipAddress: "sip:212@sip.example.invalid", enabled: true, state: "PAIRING_REQUIRED", updatedBy: manager.id } });
  return { prisma, db, suffix, firstCampus, otherCampus, commercial, manager, reader, outsider, server, profile, managerProfile };
}
