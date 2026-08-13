import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest, Principal, Role, Scope } from "./auth.types.js";

const ROLES = "crm:roles";
export const RequireRoles = (...required: Role[]): ReturnType<typeof SetMetadata> => SetMetadata(ROLES, required);

export function canAccessScope(principal: Principal, scope: Scope): boolean {
  if (principal.scopes.some((candidate) => candidate.kind === "GLOBAL")) return true;
  return principal.scopes.some((candidate) => candidate.kind === scope.kind && "id" in candidate && "id" in scope && candidate.id === scope.id);
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" });
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length > 0 && !required.some((role) => request.principal?.roles.includes(role))) {
      throw new ForbiddenException({ code: "role_forbidden" });
    }
    return true;
  }
}
