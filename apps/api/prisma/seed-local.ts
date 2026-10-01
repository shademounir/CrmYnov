import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { basename } from "node:path";
import { acquirePermissionFence } from "../src/permissions/permission-fence.js";

export const LOCAL_SYNTHETIC_IDENTITIES = Object.freeze([
  { professionalEmail: "super-admin@example.invalid", roles: ["SUPER_ADMIN"], campusId: null, teamId: null },
  { professionalEmail: "admin@example.invalid", roles: ["ADMIN"], campusId: null, teamId: null },
  { professionalEmail: "manager@example.invalid", roles: ["MANAGER"], campusId: "SYNTHETIC", teamId: "ADMISSIONS" },
  { professionalEmail: "adviser@example.invalid", roles: ["ADMISSIONS"], campusId: "SYNTHETIC", teamId: "ADMISSIONS" },
  { professionalEmail: "reader@example.invalid", roles: ["AUDITOR"], campusId: null, teamId: null },
] as const);

export function validateLocalSeedPassword(value: string): string {
  if (value.length < 14 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^a-zA-Z0-9]/.test(value) || /\s/.test(value)) {
    throw new Error("CRM_LOCAL_SEED_PASSWORD must satisfy the local synthetic password policy.");
  }
  return value;
}

type LocalSeedClient = Pick<PrismaClient, "collaborator" | "localPasswordHash">;

export async function seedLocalIdentity(prisma: LocalSeedClient, password: string): Promise<void> {
  const validatedPassword = validateLocalSeedPassword(password);
  for (const identity of LOCAL_SYNTHETIC_IDENTITIES) {
    const collaborator = await prisma.collaborator.upsert({
      where: { professionalEmail: identity.professionalEmail },
      create: { professionalEmail: identity.professionalEmail, roles: [...identity.roles], campusId: identity.campusId, teamId: identity.teamId, active: true, firstLoginRequired: false, authenticationVersion: 1 },
      update: { active: true, roles: [...identity.roles], campusId: identity.campusId, teamId: identity.teamId },
    });
    const salt = randomBytes(16).toString("hex");
    const passwordDigest = scryptSync(validatedPassword, salt, 32).toString("hex");
    const identityDigest = createHash("sha256").update(identity.professionalEmail).digest("hex");
    await prisma.localPasswordHash.upsert({
      where: { collaboratorId: collaborator.id },
      create: { collaboratorId: collaborator.id, identityDigest, passwordSalt: salt, passwordDigest, mustChange: false },
      update: { identityDigest, passwordSalt: salt, passwordDigest, mustChange: false },
    });
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "write");
      await seedLocalIdentity(tx, process.env.CRM_LOCAL_SEED_PASSWORD ?? "");
    }, { isolationLevel: "Serializable", timeout: 30_000, maxWait: 5_000 });
    process.stdout.write("Synthetic local Super Admin seed is ready.\n");
  } finally {
    await prisma.$disconnect();
  }
}

if (["seed-local.ts", "seed-local.js"].includes(basename(process.argv[1] ?? ""))) {
  void main().catch(() => {
    process.stderr.write("Synthetic local seed failed.\n");
    process.exitCode = 1;
  });
}
