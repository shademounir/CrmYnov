import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { LOCAL_SYNTHETIC_IDENTITIES, seedLocalIdentity, validateLocalSeedPassword } from "../prisma/seed-local.js";

test("validates the local seed password without exposing it", () => {
  assert.equal(validateLocalSeedPassword("Synthetic1!Password"), "Synthetic1!Password");
  for (const invalid of ["", "short", "alllowercase1!", "ALLUPPERCASE1!", "NoNumber!Value", "NoSymbol1Value", "Has space1!Value"]) {
    assert.throws(() => validateLocalSeedPassword(invalid), /CRM_LOCAL_SEED_PASSWORD/);
  }
});

test("upserts the five synthetic recipe roles and stores only derived password material", async () => {
  const writes: unknown[] = [];
  const client = {
    collaborator: {
      upsert: (input: unknown): Promise<{ id: string }> => {
        writes.push(input);
        return Promise.resolve({ id: "synthetic-admin" });
      },
    },
    localPasswordHash: {
      upsert: (input: unknown): Promise<object> => {
        writes.push(input);
        return Promise.resolve({});
      },
    },
  } as unknown as PrismaClient;
  const rawPassword = "Synthetic1!Password";
  await seedLocalIdentity(client, rawPassword);
  assert.equal(writes.length, LOCAL_SYNTHETIC_IDENTITIES.length * 2);
  assert.equal(JSON.stringify(writes).includes(rawPassword), false);
  for (const identity of LOCAL_SYNTHETIC_IDENTITIES) assert.equal(JSON.stringify(writes).includes(identity.professionalEmail), true);
  assert.deepEqual(LOCAL_SYNTHETIC_IDENTITIES.map((identity) => identity.roles[0]), ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"]);
});
