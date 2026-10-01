import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly enabled = Boolean(process.env.DATABASE_URL?.trim());
  private readonly root: PrismaClient | undefined = this.enabled ? new PrismaClient() : undefined;
  private readonly transactionContext = new AsyncLocalStorage<PrismaClient>();
  get client(): PrismaClient | undefined { return this.transactionContext.getStore() ?? this.root; }

  /** Nested repository transactions participate in the same authorization/write unit. */
  withTransaction<T>(tx: Prisma.TransactionClient, operation: () => Promise<T>): Promise<T> {
    if (!this.root) throw new Error("database_unavailable");
    const client = new Proxy(this.root, {
      get: (_target, property): unknown => {
        if (property === "$transaction") return (action: unknown): Promise<unknown> => {
          if (typeof action === "function") return Promise.resolve(Reflect.apply(action, undefined, [tx]) as unknown);
          if (Array.isArray(action)) return Promise.all(action as unknown[]);
          throw new Error("nested_transaction_invalid");
        };
        const value: unknown = Reflect.get(tx, property);
        return typeof value === "function" ? value.bind(tx) as unknown : value;
      },
    });
    return this.transactionContext.run(client, operation);
  }

  async onModuleDestroy(): Promise<void> {
    await this.root?.$disconnect();
  }
}
