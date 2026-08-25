import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { basename } from "node:path";

const EMAIL = "super-admin@example.invalid";

export function validateLocalSeedPassword(value: string): string {
  if (value.length < 14 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^a-zA-Z0-9]/.test(value) || /\s/.test(value)) {
    throw new Error("CRM_LOCAL_SEED_PASSWORD must satisfy the local synthetic password policy.");
  }
  return value;
}

type LocalSeedClient = Pick<PrismaClient, "collaborator" | "localPasswordHash">;

export async function seedLocalIdentity(prisma: LocalSeedClient, password: string): Promise<void> {
    const validatedPassword = validateLocalSeedPassword(password);
    const collaborator = await prisma.collaborator.upsert({
      where: { professionalEmail: EMAIL },
      create: { professionalEmail: EMAIL, roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false, authenticationVersion: 1 },
      update: { active: true, roles: ["SUPER_ADMIN"] },
    });
    const salt = randomBytes(16).toString("hex");
    const passwordDigest = scryptSync(validatedPassword, salt, 32).toString("hex");
    const identityDigest = createHash("sha256").update(EMAIL).digest("hex");
    await prisma.localPasswordHash.upsert({
      where: { collaboratorId: collaborator.id },
      create: { collaboratorId: collaborator.id, identityDigest, passwordSalt: salt, passwordDigest, mustChange: false },
      update: { identityDigest, passwordSalt: salt, passwordDigest, mustChange: false },
    });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedLocalIdentity(prisma, process.env.CRM_LOCAL_SEED_PASSWORD ?? "");
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
