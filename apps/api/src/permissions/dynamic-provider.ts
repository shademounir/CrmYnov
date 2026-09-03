import { Inject, Injectable } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { DefaultGrantProvider, GrantProvider, type Grant, type ResourceContext } from "./permission.service.js";
import { DynamicPermissionService } from "./dynamic-service.js";

/** Existing reference-specific invariants remain an additional upper bound. */
@Injectable()
export class DynamicGrantProvider extends GrantProvider {
  constructor(@Inject(DynamicPermissionService) private readonly permissions: DynamicPermissionService) { super(); }
  grants(): Promise<readonly Grant[]> { return Promise.resolve([]); }
  override async decision(principal: Principal, permission: string, resource: ResourceContext): Promise<boolean> {
    const decision = await this.permissions.decision(principal, permission, resource);
    if (!decision.allowed) return false;
    if (permission !== "lead.references.view") return true;
    // Legacy/read-only references are visible only through their authorized lead context.
    const legacy = await new DefaultGrantProvider().grants(principal);
    return legacy.some((grant) => grant.permission === permission && (
      grant.scope === "GLOBAL" || grant.scope === "APPLICABLE" ||
      grant.scope === "ACTIVE_APPLICABLE" && resource.active ||
      grant.scope === "READABLE_RESOURCE" && resource.readableResource === true
    ));
  }
}
