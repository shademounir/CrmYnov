import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";

@Injectable()
export class ReportingPersistenceGuard implements CanActivate {
  constructor(@Inject(ReportingPersistenceService) private readonly persistence: ReportingPersistenceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    void context;
    await this.persistence.refresh();
    return true;
  }
}
