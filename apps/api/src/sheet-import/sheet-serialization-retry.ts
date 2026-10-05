import { setTimeout } from "node:timers/promises";

/** Retry only a fully rolled-back Serializable conflict. The caller must reopen
 * and reauthorize its entire database transaction on every invocation; external
 * reads must remain outside this callback. Contention may still exhaust the cap. */
export async function retrySheetSerialization<T>(transaction: () => Promise<T>,
  wait: (delayMs: number) => Promise<unknown> = setTimeout): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await transaction(); }
    catch (error) {
      if (attempt === 2 || !isSerializationConflict(error)) throw error;
      // The rejected transaction has finished before this wait. Give competing
      // work a bounded opportunity to commit: 25 ms, then 50 ms (75 ms total).
      await wait(25 * (attempt + 1));
    }
  }
  throw new Error("sheet_transaction_conflict");
}

function isSerializationConflict(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "P2034";
}
