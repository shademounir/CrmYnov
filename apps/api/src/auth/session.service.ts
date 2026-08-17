import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal, Role, Scope } from "./auth.types.js";

interface SessionRecord extends Principal {
  token: string;
  active: boolean;
  expiresAt: number;
}

@Injectable()
export class SessionService {
  private readonly sessions = new Map<string, SessionRecord>();

  create(userId: string, roles: Role[], scopes: Scope[], lifetimeMs = 3_600_000, mustChangeSecret = false): { token: string; sessionId: string } {
    const sessionId = randomUUID();
    const token = randomUUID();
    this.sessions.set(token, { userId, roles: [...roles], scopes: [...scopes], sessionId, token, active: true, expiresAt: Date.now() + lifetimeMs, mustChangeSecret });
    return { token, sessionId };
  }

  authenticate(token: string): Principal | undefined {
    const session = this.sessions.get(token);
    if (!session?.active || session.expiresAt <= Date.now()) return undefined;
    return { userId: session.userId, roles: [...session.roles], scopes: [...session.scopes], sessionId: session.sessionId, mustChangeSecret: session.mustChangeSecret };
  }

  revoke(sessionId: string): boolean {
    const session = [...this.sessions.values()].find((candidate) => candidate.sessionId === sessionId);
    if (!session) return false;
    session.active = false;
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
    return revoked;
  }
}
