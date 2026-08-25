import { Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../persistence/prisma.service.js";

interface ChallengeRecord {
  id: string;
  subjectId: string;
  returnPath: string;
  expiresAt: number;
  used: boolean;
}

interface CredentialRecord {
  subjectId: string;
  identityDigest: string;
  salt: string;
  digest: string;
  mustChange: boolean;
}

export function digestRecoveryValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deriveSecret(secret: string, salt: string): string {
  return scryptSync(secret, salt, 32).toString("hex");
}

@Injectable()
export class LocalRecoveryChallengeStore implements OnModuleInit {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.prisma?.client?.localRecoveryChallenge.findMany({ where: { usedAt: null, expiresAt: { gt: new Date() } } });
    for (const row of rows ?? []) this.challenges.set(row.tokenDigest, { id: row.id, subjectId: row.collaboratorId, returnPath: row.returnPath, expiresAt: row.expiresAt.getTime(), used: false });
  }

  issue(subjectId: string, returnPath: string, now = Date.now(), lifetimeMs = 15 * 60_000): string {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenDigest = digestRecoveryValue(rawToken);
    const id = randomUUID();
    const expiresAt = now + lifetimeMs;
    this.challenges.set(tokenDigest, { id, subjectId, returnPath, expiresAt, used: false });
    const client = this.prisma?.client;
    if (client) this.enqueue(client.localRecoveryChallenge.create({ data: { id, collaboratorId: subjectId, tokenDigest, returnPath, expiresAt: new Date(expiresAt) } }));
    return rawToken;
  }

  consume(rawToken: string, returnPath: string, now = Date.now()): string | undefined {
    const record = this.challenges.get(digestRecoveryValue(rawToken));
    if (!record || record.used || record.expiresAt <= now || record.returnPath !== returnPath) return undefined;
    record.used = true;
    const client = this.prisma?.client;
    if (client) this.enqueue(client.localRecoveryChallenge.update({ where: { id: record.id }, data: { usedAt: new Date(now) } }));
    return record.subjectId;
  }

  hasStoredRawToken(rawToken: string): boolean {
    return JSON.stringify([...this.challenges.values()]).includes(rawToken);
  }

  async flush(): Promise<void> { await this.pendingWrite; }
  private enqueue(operation: Promise<unknown>): void { this.pendingWrite = this.pendingWrite.then(() => operation); }
}

@Injectable()
export class LocalIdentityDirectory implements OnModuleInit {
  private readonly identities = new Map<string, string>([[digestRecoveryValue("known-user@example.invalid"), digestRecoveryValue("known-user@example.invalid")]]);

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.prisma?.client?.collaborator.findMany({ where: { active: true }, select: { id: true, professionalEmail: true } });
    for (const row of rows ?? []) this.identities.set(digestRecoveryValue(row.professionalEmail), row.id);
  }

  has(identityDigest: string): boolean { return this.identities.has(identityDigest); }
  resolve(identityDigest: string): string | undefined { return this.identities.get(identityDigest); }
  register(email: string, subjectId: string): void { this.identities.set(digestRecoveryValue(email.trim().toLowerCase()), subjectId); }
}

@Injectable()
export class LocalCredentialAdapter implements OnModuleInit {
  private readonly credentials = new Map<string, CredentialRecord>();
  private readonly identityToSubject = new Map<string, string>();
  private pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.prisma?.client?.localPasswordHash.findMany();
    for (const row of rows ?? []) this.store({ subjectId: row.collaboratorId, identityDigest: row.identityDigest, salt: row.passwordSalt, digest: row.passwordDigest, mustChange: row.mustChange });
  }

  replace(subjectKey: string, nextSecret: string): void {
    const current = this.lookup(subjectKey);
    const subjectId = current?.subjectId ?? subjectKey;
    const identityDigest = current?.identityDigest ?? subjectKey;
    this.persist({ subjectId, identityDigest, ...this.hash(nextSecret), mustChange: false });
  }

  provisionTemporary(subjectId: string, temporarySecret: string, identityDigest = subjectId): void {
    this.persist({ subjectId, identityDigest, ...this.hash(temporarySecret), mustChange: true });
  }

  replaceRequired(subjectKey: string, currentSecret: string, nextSecret: string): boolean {
    const current = this.lookup(subjectKey);
    if (!current?.mustChange || !this.matches(current, currentSecret)) return false;
    this.persist({ ...current, ...this.hash(nextSecret), mustChange: false });
    return true;
  }

  verifyIdentity(identityDigest: string, secret: string): { subjectId: string; mustChange: boolean } | undefined {
    const current = this.lookup(identityDigest);
    return current && this.matches(current, secret) ? { subjectId: current.subjectId, mustChange: current.mustChange } : undefined;
  }

  requiresChange(subjectKey: string): boolean { return this.lookup(subjectKey)?.mustChange === true; }
  hasStoredRawSecret(rawSecret: string): boolean { return JSON.stringify([...this.credentials.values()]).includes(rawSecret); }
  async flush(): Promise<void> { await this.pendingWrite; }

  private lookup(subjectKey: string): CredentialRecord | undefined {
    return this.credentials.get(this.identityToSubject.get(subjectKey) ?? subjectKey);
  }

  private store(record: CredentialRecord): void {
    this.credentials.set(record.subjectId, record);
    this.identityToSubject.set(record.identityDigest, record.subjectId);
  }

  private persist(record: CredentialRecord): void {
    this.store(record);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.localPasswordHash.upsert({
      where: { collaboratorId: record.subjectId },
      create: { collaboratorId: record.subjectId, identityDigest: record.identityDigest, passwordSalt: record.salt, passwordDigest: record.digest, mustChange: record.mustChange },
      update: { identityDigest: record.identityDigest, passwordSalt: record.salt, passwordDigest: record.digest, mustChange: record.mustChange },
    }));
  }

  private hash(secret: string): { salt: string; digest: string } {
    const salt = randomBytes(16).toString("hex");
    return { salt, digest: deriveSecret(secret, salt) };
  }

  private matches(record: CredentialRecord, secret: string): boolean {
    const expected = Buffer.from(record.digest, "hex");
    const actual = Buffer.from(deriveSecret(secret, record.salt), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private enqueue(operation: Promise<unknown>): void { this.pendingWrite = this.pendingWrite.then(() => operation); }
}
