import { Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Principal, Role, Scope } from "./auth.types.js";
import { isRole } from "./auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";

interface SessionRecord extends Principal {
  tokenDigest: string;
  active: boolean;
  expiresAt: number;
  authenticationVersion: number;
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validScopes(value: unknown): Scope[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is Scope => {
    if (!scope || typeof scope !== "object" || !("kind" in scope)) return false;
    const candidate = scope as { kind?: unknown; id?: unknown };
    return candidate.kind === "GLOBAL"
      || ((candidate.kind === "CAMPUS" || candidate.kind === "TEAM") && typeof candidate.id === "string");
  });
}

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly authenticationVersions = new Map<string, number>();
  private readonly activeUsers = new Map<string, boolean>();
  private pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const client = this.prisma?.client;
    if (!client) return;
    const rows = await client.localSession.findMany({
      where: { active: true, expiresAt: { gt: new Date() } },
      include: { collaborator: { select: { active: true, authenticationVersion: true, passwordHash: { select: { mustChange: true } } } } },
    });
    for (const row of rows) {
      this.authenticationVersions.set(row.collaboratorId, row.collaborator.authenticationVersion);
      this.activeUsers.set(row.collaboratorId, row.collaborator.active);
      this.sessions.set(row.tokenDigest, {
        userId: row.collaboratorId,
        roles: row.roles as Role[],
        scopes: validScopes(row.scopes),
        sessionId: row.id,
        tokenDigest: row.tokenDigest,
        active: row.active,
        expiresAt: row.expiresAt.getTime(),
        mustChangeSecret: row.collaborator.passwordHash?.mustChange === true,
        authenticationVersion: row.authenticationVersion,
      });
    }
  }

  create(userId: string, roles: Role[], scopes: Scope[], lifetimeMs = 3_600_000, mustChangeSecret = false, authenticationVersion = 1): { token: string; sessionId: string } {
    const sessionId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const tokenDigest = digestToken(token);
    const expiresAt = Date.now() + lifetimeMs;
    this.authenticationVersions.set(userId, authenticationVersion);
    this.activeUsers.set(userId, true);
    this.sessions.set(tokenDigest, { userId, roles: [...roles], scopes: [...scopes], sessionId, tokenDigest, active: true, expiresAt, mustChangeSecret, authenticationVersion });
    const client = this.prisma?.client;
    if (client) {
      this.enqueue(client.localSession.create({ data: {
        id: sessionId,
        collaboratorId: userId,
        tokenDigest,
        roles,
        scopes,
        authenticationVersion,
        active: true,
        expiresAt: new Date(expiresAt),
      } }));
    }
    return { token, sessionId };
  }

  authenticate(token: string): Principal | undefined {
    const session = this.sessions.get(digestToken(token));
    if (!session?.active || session.expiresAt <= Date.now()) return undefined;
    if (this.activeUsers.get(session.userId) === false) return undefined;
    if ((this.authenticationVersions.get(session.userId) ?? session.authenticationVersion) !== session.authenticationVersion) return undefined;
    return { userId: session.userId, roles: [...session.roles], scopes: [...session.scopes], sessionId: session.sessionId, mustChangeSecret: session.mustChangeSecret };
  }

  /** Persistent sessions must work on every API instance and never use stale identity. */
  async authenticateForApi(token: string): Promise<Principal | undefined> {
    const client = this.prisma?.client;
    if (!client) return this.authenticate(token); // Explicit historical in-memory harness.
    const tokenDigest = digestToken(token);
    const row = await client.localSession.findUnique({ where: { tokenDigest }, include: { collaborator: { include: { passwordHash: { select: { mustChange: true } } } } } });
    if (!row?.active || row.expiresAt <= new Date()) return undefined;
    const user = row.collaborator;
    if (!user.active || row.authenticationVersion !== user.authenticationVersion || !user.roles.length || !user.roles.every(isRole)) return undefined;
    const scopes: Scope[] = [];
    if (user.roles.includes("SUPER_ADMIN")) scopes.push({ kind: "GLOBAL" });
    if (user.campusId) scopes.push({ kind: "CAMPUS", id: user.campusId });
    if (user.teamId) scopes.push({ kind: "TEAM", id: user.teamId });
    const principal: Principal = { userId: user.id, sessionId: row.id, roles: user.roles, scopes, mustChangeSecret: user.firstLoginRequired || user.passwordHash?.mustChange === true };
    this.sessions.set(tokenDigest, { ...principal, tokenDigest, active: true, expiresAt: row.expiresAt.getTime(), authenticationVersion: row.authenticationVersion });
    this.updateIdentityState(user.id, user.active, user.authenticationVersion);
    return principal;
  }

  revoke(sessionId: string): boolean {
    const session = [...this.sessions.values()].find((candidate) => candidate.sessionId === sessionId);
    if (!session) return false;
    session.active = false;
    const client = this.prisma?.client;
    if (client) this.enqueue(client.localSession.updateMany({ where: { id: sessionId, active: true }, data: { active: false, revokedAt: new Date() } }));
    return true;
  }

  revokeUser(userId: string): number {
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.active) {
        session.active = false;
        revoked += 1;
      }
    }
    const client = this.prisma?.client;
    if (client) this.enqueue(client.localSession.updateMany({ where: { collaboratorId: userId, active: true }, data: { active: false, revokedAt: new Date() } }));
    return revoked;
  }

  updateIdentityState(userId: string, active: boolean, authenticationVersion: number): void {
    this.activeUsers.set(userId, active);
    this.authenticationVersions.set(userId, authenticationVersion);
  }

  async flush(): Promise<void> {
    await this.pendingWrite;
  }

  private enqueue(operation: Promise<unknown>): void {
    this.pendingWrite = this.pendingWrite.then(() => operation);
  }
}
