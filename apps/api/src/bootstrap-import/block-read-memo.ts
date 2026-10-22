import { AsyncLocalStorage } from "node:async_hooks";

/** Only immutable reference/grant/sealed-source reads inside ONE fenced import transaction.
 * Never use for principals, sessions, contacts, receipts or mutable Lead state.
 * No value survives the block or is reused by a different transaction. */
export class BlockReadMemo<Transaction extends object> {
  private readonly scope = new AsyncLocalStorage<{ tx: Transaction; reads: Map<string, Promise<unknown>> }>();

  run<T>(tx: Transaction, action: () => Promise<T>): Promise<T> {
    return this.scope.run({ tx, reads: new Map() }, action);
  }

  active(tx: Transaction): boolean { return this.scope.getStore()?.tx === tx; }

  read<T>(tx: Transaction, key: string, load: () => Promise<T>): Promise<T> {
    const current = this.scope.getStore();
    if (!current || current.tx !== tx) return load();
    let value = current.reads.get(key);
    if (!value) { value = load(); current.reads.set(key, value); }
    return value as Promise<T>;
  }
}
