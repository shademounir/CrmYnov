import { CanActivate, Inject, Injectable } from "@nestjs/common";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";

@Injectable()
export class ReportingPersistenceGuard implements CanActivate {
  constructor(@Inject(ReportingPersistenceService) private readonly persistence: ReportingPersistenceService) {}

  async canActivate(): Promise<boolean> {
    await this.persistence.refresh();
    return true;
  }
}
