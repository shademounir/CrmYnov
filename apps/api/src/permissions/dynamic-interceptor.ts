import { Inject, Injectable, UnauthorizedException, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { from, lastValueFrom, type Observable } from "rxjs";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard } from "../auth/rbac.guard.js";
import { UserService } from "../users/user.service.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "./dynamic-repository.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext } from "./dynamic-context.js";
import { contextualPermissions, lifecycleControllers, routePermissions } from "./dynamic-routes.js";
import { evaluatePermission } from "./dynamic-evaluator.js";
import { leadResource, routeContexts } from "./dynamic-resources.js";
import type { ConfigurationSnapshot } from "./dynamic-contract.js";
import { DynamicResourceLocator } from "./dynamic-locator.js";

/**
 * Linearization fence, shared by all API instances through PostgreSQL. Business
 * transactions keep their existing atomicity; revocations cannot commit between
 * this final authorization check and completion of the protected handler.
 */
@Injectable()
export class DynamicPermissionInterceptor implements NestInterceptor {
  constructor(
    @Inject(DynamicPermissionRepository) private readonly repository: DynamicPermissionRepository,
    @Inject(RbacGuard) private readonly rbac: RbacGuard,
    @Inject(UserService) private readonly users: UserService,
    @Inject(DynamicResourceLocator) private readonly locator: DynamicResourceLocator,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const controller = context.getClass().name;
    if (lifecycleControllers.has(controller)) return next.handle();
    return from(this.repository.transaction(async (tx) => {
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" });
      request.principal = await currentPrincipal(tx, request.principal);
      this.rbac.canActivate(context); // Re-evaluate role invariants with current DB identity.
      const keys = routePermissions(controller, context.getHandler().name);
      if (keys === null) permissionDenied();
      const rows = await this.repository.snapshots(tx);
      if (controller === "UserController") await this.users.onModuleInit();
      const serverLeadIds = this.locator.leadIds(controller, context.getHandler().name, request);
      for (const key of contextualPermissions(controller, keys, request.body, request.query, request.principal.roles.includes("SUPER_ADMIN"))) {
        if (controller === "LeadController" && context.getHandler().name === "list") {
          await this.filterLeadCollection(tx, request, rows);
        } else {
          const contexts = await routeContexts(tx, request, controller, key, request.principal, serverLeadIds);
          if (!contexts.length || contexts.some((resource) => !evaluatePermission(request.principal!, key, rows, resource).allowed)) permissionDenied();
        }
      }
      return lastValueFrom(next.handle());
    }));
  }
  private async filterLeadCollection(tx: PermissionTransaction, request: AuthenticatedRequest, rows: ConfigurationSnapshot[]): Promise<void> {
    const principal = request.principal as Principal;
    const contexts = await routeContexts(tx, request, "LeadController", "lead.view", principal);
    // A resource-limited grant may produce an empty authorized collection.
    if (!contexts.some((context) => evaluatePermission(principal, "lead.view", rows, { ...context, own: true, team: true, managedTeam: true }).allowed)) permissionDenied();
    const campusKeys = principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []);
    const leads = await tx.lead.findMany({ where: principal.roles.includes("SUPER_ADMIN") ? {} : { campus: { in: campusKeys } }, select: { id: true } });
    const allowed = new Set<string>();
    for (const lead of leads) {
      const resource = await resourceEvaluationContext(tx, principal, await leadResource(tx, lead.id));
      if (evaluatePermission(principal, "lead.view", rows, resource).allowed) allowed.add(lead.id);
    }
    principal.permissionLeadIds = allowed;
  }
}
