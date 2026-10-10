import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { lastValueFrom, of } from "rxjs";
import type { AuthenticatedRequest } from "../src/auth/auth.types.js";
import { RbacGuard } from "../src/auth/rbac.guard.js";
import { DynamicPermissionInterceptor } from "../src/permissions/dynamic-interceptor.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import { SheetImportController } from "../src/sheet-import/sheet-import.controller.js";

function fixture(handler: string): {
  interceptor: DynamicPermissionInterceptor; context: ExecutionContext; request: AuthenticatedRequest;
  inTransaction: () => boolean; checks: () => number;
} {
  let active = false, checks = 0;
  const request = { principal: { userId: "synthetic-user", sessionId: "synthetic-session", roles: ["MANAGER"], scopes: [] } } as unknown as AuthenticatedRequest;
  const tx = {
    collaborator: { findUnique: () => Promise.resolve({ id: "synthetic-user", active: true, roles: ["SUPER_ADMIN"], authenticationVersion: 1, campusId: null }) },
    localSession: { findUnique: () => Promise.resolve({ collaboratorId: "synthetic-user", active: true, authenticationVersion: 1, expiresAt: new Date(Date.now() + 60000) }) },
  } as unknown as PermissionTransaction;
  const repository = {
    readTransaction: async (action: (transaction: PermissionTransaction) => Promise<unknown>): Promise<unknown> => {
      checks++; active = true;
      try { return await action(tx); } finally { active = false; }
    },
    transaction: (): never => { throw new Error("outer_write_transaction_forbidden"); },
  } as unknown as DynamicPermissionRepository;
  const context = {
    getClass: () => SheetImportController,
    getHandler: (): unknown => Object.getOwnPropertyDescriptor(SheetImportController.prototype, handler)?.value as unknown ?? { name: handler },
    switchToHttp: (): { getRequest: () => AuthenticatedRequest } => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  // No lifecycle/resource providers may run on this reviewed split-phase path.
  const unused = [undefined, undefined, undefined, undefined, undefined] as unknown as [
    ConstructorParameters<typeof DynamicPermissionInterceptor>[2], ConstructorParameters<typeof DynamicPermissionInterceptor>[3],
    ConstructorParameters<typeof DynamicPermissionInterceptor>[4], ConstructorParameters<typeof DynamicPermissionInterceptor>[5],
    ConstructorParameters<typeof DynamicPermissionInterceptor>[6],
  ];
  const interceptor = new DynamicPermissionInterceptor(repository, new RbacGuard(new Reflector()), ...unused);
  return { interceptor, context, request, inTransaction: () => active, checks: () => checks };
}

for (const handler of ["appendBoundary", "appendReconciliation", "qualifyAppend", "observeAppend"]) {
  test(`CRMY-63 ${handler} refreshes server identity and releases the outer read fence before its own handler`, async () => {
    const f = fixture(handler);
    const result = await lastValueFrom(f.interceptor.intercept(f.context, { handle: () => {
      assert.equal(f.inTransaction(), false, "the service owns transactions around remote I/O");
      assert.deepEqual(f.request.principal?.roles, ["SUPER_ADMIN"], "stale request roles are never authoritative");
      return of("authorized-handler");
    } }));
    assert.equal(result, "authorized-handler"); assert.equal(f.checks(), 1);
  });
}

test("CRMY-63 unknown or misspelled Sheet handler still fails closed, without a wildcard bypass", () => {
  for (const handler of ["appendEverything", "appendboundary", "delete", "unknownRead"]) {
    const f = fixture(handler);
    assert.throws(() => f.interceptor.intercept(f.context, { handle: () => { throw new Error("unknown_handler_ran"); } }),
      (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "permission_denied");
    assert.equal(f.checks(), 0);
  }
});
