import { Inject, Injectable, ServiceUnavailableException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AccessRecoveryService, type RecoveryOperation } from "./access-recovery.service.js";

/** Nest guards execute before the recovery lifecycle interceptor. The durable
 * attempt commits separately, including when the business action is rejected. */
@Injectable()
export class AccessRecoveryRateLimitGuard implements CanActivate {
  constructor(@Inject(AccessRecoveryService) private readonly recovery: AccessRecoveryService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler().name;
    let operation: RecoveryOperation;
    if (handler === "request") operation = "REQUEST";
    else if (handler === "complete") operation = "COMPLETION";
    else throw new ServiceUnavailableException({ code: "recovery_operation_unavailable" });
    const request = context.switchToHttp().getRequest<Request>();
    // No untrusted forwarded/request-body client identifier is accepted.
    await this.recovery.assertClientAllowedForApi(operation, request.ip ?? "unknown");
    return true;
  }
}
