import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly enabled = Boolean(process.env.DATABASE_URL?.trim());
  readonly client: PrismaClient | undefined = this.enabled ? new PrismaClient() : undefined;

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
