/** Bound the entire session operation, including a stalled response body. No retry. */
export const SESSION_REQUEST_TIMEOUT_MS = 20_000;

export async function withSessionDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (parent?.aborted) throw new DOMException("Session request cancelled", "AbortError");
  parent?.addEventListener("abort", abort, { once: true });
  let rejectAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = (): void => reject(new DOMException("Session request cancelled", "AbortError"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const timer = globalThis.setTimeout(abort, SESSION_REQUEST_TIMEOUT_MS);
  try {
    return await Promise.race([operation(controller.signal), cancelled]);
  } finally {
    globalThis.clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}
