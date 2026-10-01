import { takeCoverage } from "node:v8";

// A compiled HTTP fixture otherwise exits via the default SIGTERM handler,
// which does not flush V8 counters. Preserve that termination semantics after
// writing native counters; this module is never loaded by a production launch.
if (!process.env.NODE_V8_COVERAGE) throw Error("coverage_shutdown_requires_instrumentation");
const flushAndExit = () => {
  takeCoverage();
  if (process.connected) process.disconnect();
  process.exit(0);
};

// Windows does not deliver POSIX termination signals consistently to a child
// Node process. The coverage-only IPC channel provides the same graceful,
// counter-flushing shutdown on every CI host.
process.once("message", (message) => {
  if (message === "flush-coverage" || message?.type === "crmy-coverage-shutdown") flushAndExit();
});
process.once("SIGTERM", flushAndExit);
