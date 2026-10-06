import type { PrismaClient } from "@prisma/client";
import { isIP } from "node:net";

export interface PilotageDatabaseIdentity { url: string; nonce: string; database: string; port: number; serverAddress: string; serverPort: number }

function privateServerAddress(value: string | undefined): value is string {
  if (!value || isIP(value) !== 4) return false;
  const [first, second] = value.split(".").map(Number);
  return value === "127.0.0.1" || first === 10 || first === 192 && second === 168 || first === 172 && second! >= 16 && second! <= 31;
}

/** A retained/preview URL is never accepted, even when the integration flag is
 * supplied. Rejected credentials must never be interpolated into diagnostics. */
export function pilotageDatabaseIdentity(env: NodeJS.ProcessEnv): PilotageDatabaseIdentity {
  const nonce = env.CRMY178_DATABASE_NONCE;
  if (env.CRMY178_EPHEMERAL_TEST !== "true" || env.SHEETS_ENABLED !== "false" || env.CRM_BACKGROUND_WORKERS !== "external"
    || env.DATABASE_URL !== undefined || !nonce || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(nonce)) {
    throw new Error("pilotage_fixture_environment_refused");
  }
  const value = env.CRMY178_DATABASE_URL;
  const serverAddress = env.CRMY178_DATABASE_SERVER_ADDRESS, serverPort = env.CRMY178_DATABASE_SERVER_PORT;
  // Docker may expose a loopback host port while PostgreSQL sees its private
  // container address/5432. Expected SQL endpoint comes from a separate owner
  // receipt, never from the very connection this test is trying to prove.
  if (!privateServerAddress(serverAddress) || !serverPort || !/^\d+$/u.test(serverPort) || Number(serverPort) < 1 || Number(serverPort) > 65535) {
    throw new Error("pilotage_fixture_server_receipt_refused");
  }
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("pilotage_fixture_database_scope_refused"); }
  const database = `crmy178_test_${nonce}`;
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.pathname !== `/${database}` || url.username !== "postgres"
    || !url.password || !/^\d+$/u.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535 || url.search || url.hash) {
    throw new Error("pilotage_fixture_database_scope_refused");
  }
  return { url: value!, nonce, database, port: Number(url.port), serverAddress, serverPort: Number(serverPort) };
}

/** This marker must be created independently by the owner of the fresh database.
 * All runtime/auth/business tables must still be empty before the first fixture
 * write; the guard never creates its own proof or cleans an occupied database. */
export async function assertEmptyPilotageDatabase(db: PrismaClient, identity: PilotageDatabaseIdentity): Promise<void> {
  try {
    const actual = await db.$queryRaw<Array<{ database: string; username: string; address: string; port: number }>>`
      SELECT current_database() AS database, current_user AS username,
        host(inet_server_addr()) AS address, inet_server_port() AS port`;
    const row = actual[0];
    if (actual.length !== 1 || row?.database !== identity.database || row.username !== "postgres" || row.address !== identity.serverAddress || row.port !== identity.serverPort) throw new Error();
    const markers = await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy178_test_identity.marker`;
    if (markers.length !== 1 || markers[0]?.nonce !== identity.nonce) throw new Error();
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    if (tables.length < 20 || !tables.some((table) => table.table_name === "collaborators") || !tables.some((table) => table.table_name === "leads")) throw new Error();
    for (const { table_name: table } of tables) {
      if (!/^[a-z0-9_]+$/u.test(table)) throw new Error();
      // Identifiers are from PostgreSQL metadata and independently constrained.
      const counts = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM public."${table}"`);
      if (counts.length !== 1 || counts[0]?.count !== 0n) throw new Error();
    }
  } catch { throw new Error("pilotage_fixture_database_identity_or_empty_state_refused"); }
}
