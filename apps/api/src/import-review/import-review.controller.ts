import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ImportReviewService, type DecideReviewInput, type EnqueueReviewInput, type ReviewItem } from "./import-review.service.js";

@Controller("lead-import/reviews") @UseGuards(RbacGuard) @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class ImportReviewController {
  constructor(@Inject(ImportReviewService) private readonly reviews: ImportReviewService) {}
  @Post() enqueue(@Body() body: EnqueueReviewInput, @Req() request: AuthenticatedRequest): ReviewItem { return this.reviews.enqueue(body, this.principal(request)); }
  @Get() list(@Req() request: AuthenticatedRequest): ReviewItem[] { return this.reviews.list(this.principal(request)); }
  @Post(":id/decisions") decide(@Param("id") id: string, @Body() body: DecideReviewInput, @Req() request: AuthenticatedRequest): ReviewItem { return this.reviews.decide(id, body, this.principal(request)); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
}
