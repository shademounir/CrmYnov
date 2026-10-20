import { Module } from "@nestjs/common";
import { FollowUpPersistenceRepository } from "../follow-up/follow-up-persistence.repository.js";
import { PrismaService } from "../persistence/prisma.service.js";

/** System-owned bounded due processing, not an HTTP API or catalogue upgrade. */
@Module({ providers: [PrismaService, FollowUpPersistenceRepository] })
export class FollowUpDueJobModule {}
