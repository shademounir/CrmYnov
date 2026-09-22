// The official image's temporary init server listens on a Unix socket only.
// Query TCP explicitly so readiness cannot succeed before initdb has finished.
export async function waitForPostgres(container, docker, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt <= 60; attempt++) {
    try {
      const result = docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", "SELECT 1"]);
      if (result.trim() === "1") return;
    } catch { /* Retry only this read-only readiness probe. */ }
    if (attempt < 60) await delay(250);
  }
  throw new Error("coverage_postgres_not_ready");
}
