import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const EMAIL = "super-admin@example.invalid";

function requiredPassword(): string {
  const value = process.env.CRM_LOCAL_SEED_PASSWORD ?? "";
  if (value.length < 14 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^a-zA-Z0-9]/.test(value) || /\s/.test(value)) {
    throw new Error("CRM_LOCAL_SEED_PASSWORD must satisfy the local synthetic password policy.");
  }
  return value;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const password = requiredPassword();
    const collaborator = await prisma.collaborator.upsert({
      where: { professionalEmail: EMAIL },
      create: { professionalEmail: EMAIL, roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false, authenticationVersion: 1 },
      update: { active: true, roles: ["SUPER_ADMIN"] },
    });
    const salt = randomBytes(16).toString("hex");
    const passwordDigest = scryptSync(password, salt, 32).toString("hex");
    const identityDigest = createHash("sha256").update(EMAIL).digest("hex");
    await prisma.localPasswordHash.upsert({
      where: { collaboratorId: collaborator.id },
      create: { collaboratorId: collaborator.id, identityDigest, passwordSalt: salt, passwordDigest, mustChange: false },
      update: { identityDigest, passwordSalt: salt, passwordDigest, mustChange: false },
    });
    process.stdout.write("Synthetic local Super Admin seed is ready.\n");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  process.stderr.write("Synthetic local seed failed.\n");
  process.exitCode = 1;
});
