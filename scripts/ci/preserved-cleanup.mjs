/** Preserve the operation's error even when its bounded cleanup also fails. */
export async function withPreservedCleanup(operation, cleanup) {
  const failures = [];
  let result;
  try { result = await operation(); } catch (error_) { failures.push(error_); }
  try { await cleanup(); } catch (error_) { failures.push(error_); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "operation_and_preserved_cleanup_failed", { cause: failures[0] });
  return result;
}
