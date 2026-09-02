import { randomUUID } from "node:crypto";
import { ReferenceRepository, type ReferenceTransaction } from "../../src/references/reference.repository.js";
import type { PrismaService } from "../../src/persistence/prisma.service.js";

type Row = Record<string, unknown>;
type Args = { where?: Row | undefined; data?: Row | undefined; create?: Row | undefined; update?: Row | undefined; include?: Row | undefined };
const names = ["crmReference", "crmReferenceKey", "crmProgramAvailability", "crmLeadTag", "lead", "leadActivity", "auditEvent", "leadMutationReceipt"] as const;
type Model = typeof names[number];
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some((item) => matches(row, item));
    if (key.includes("_")) return matches(row, value as Row);
    if (value && typeof value === "object") {
      if ("in" in value) return (value.in as unknown[]).includes(row[key]);
      if ("notIn" in value) return !(value.notIn as unknown[]).includes(row[key]);
    }
    return row[key] === value;
  });
}
export function referenceStore(): { repository: ReferenceRepository; rows: Record<Model, Row[]>; failAudit: () => void } {
  const rows: Record<Model, Row[]> = { crmReference: [], crmReferenceKey: [], crmProgramAvailability: [], crmLeadTag: [], lead: [], leadActivity: [], auditEvent: [], leadMutationReceipt: [] };
  let auditFails = false;
  function related(model: Model, row: Row): Row {
    if (model === "crmReferenceKey") return { ...row, reference: rows.crmReference.find((item) => item.id === row.referenceId) };
    if (model === "crmLeadTag") return { ...row, tag: rows.crmReference.find((item) => item.id === row.tagId) };
    if (model === "lead") return { ...row, collaborators: row.collaborators ?? [] };
    return { ...row };
  }
  function create(model: Model, data: Row = {}): Row {
    if (model === "auditEvent" && auditFails) throw new Error("synthetic audit failure");
    const uniqueFields = model === "crmReference" ? ["kind", "scopeKey", "code"] : model === "crmReferenceKey" ? ["kind", "scopeKey", "key"] : model === "leadMutationReceipt" ? ["idempotencyKey"] : [];
    if (uniqueFields.length && rows[model].some((row) => uniqueFields.every((key) => row[key] === data[key]))) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    const row: Row = { id: randomUUID(), state: "ACTIVE", active: true, version: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
    rows[model].push(row); return related(model, row);
  }
  function update(model: Model, args: Args): Row {
    const row = rows[model].find((item) => matches(item, args.where));
    if (!row) throw new Error("not found");
    for (const [key, value] of Object.entries(args.data ?? {})) row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
    return related(model, row);
  }
  const models = Object.fromEntries(names.map((model) => [model, {
    findMany: (args: Args = {}): Promise<Row[]> => Promise.resolve(rows[model].filter((row) => matches(row, args.where)).map((row) => related(model, row))),
    findUnique: (args: Args): Promise<Row | null> => Promise.resolve(rows[model].find((row) => matches(row, args.where))).then((row) => row ? related(model, row) : null),
    findUniqueOrThrow: (args: Args): Promise<Row> => { const row = rows[model].find((item) => matches(item, args.where)); return row ? Promise.resolve(related(model, row)) : Promise.reject(new Error("not found")); },
    count: (args: Args): Promise<number> => Promise.resolve(rows[model].filter((row) => matches(row, args.where)).length),
    create: (args: Args): Promise<Row> => Promise.resolve().then(() => create(model, args.data)),
    update: (args: Args): Promise<Row> => Promise.resolve().then(() => update(model, args)),
    updateMany: (args: Args): Promise<{ count: number }> => { const targets = rows[model].filter((row) => matches(row, args.where)); targets.forEach((row) => update(model, { where: { id: row.id }, data: args.data })); return Promise.resolve({ count: targets.length }); },
    upsert: (args: Args): Promise<Row> => Promise.resolve().then(() => rows[model].some((row) => matches(row, args.where)) ? update(model, { where: args.where, data: args.update }) : create(model, args.create)),
  }]));
  const client = { ...models, $transaction: async <T>(action: (tx: ReferenceTransaction) => Promise<T>): Promise<T> => {
    const snapshot = structuredClone(rows);
    try { return await action(models as unknown as ReferenceTransaction); }
    catch (error) { for (const name of names) rows[name] = snapshot[name]; throw error; }
  } };
  return { repository: new ReferenceRepository({ client } as unknown as PrismaService), rows, failAudit: (): void => { auditFails = true; } };
}
