import { takeCoverage } from "node:v8";

// A compiled HTTP fixture otherwise exits via the default SIGTERM handler,
// which does not flush V8 counters. Preserve that termination semantics after
// writing native counters; this module is never loaded by a production launch.
if (!process.env.NODE_V8_COVERAGE) throw Error("coverage_shutdown_requires_instrumentation");
process.once("SIGTERM", () => {
  takeCoverage();
  process.kill(process.pid, "SIGTERM");
});
