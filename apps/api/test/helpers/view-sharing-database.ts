import { resolve4 } from "node:dns/promises";
import type { PrismaClient } from "@prisma/client";

export interface SharingDatabase {
  url: string;
  external: boolean;
  database: string;
}

/** Test-only alias, never inferred from a caller-controlled hostname. */
export const sharingDatabaseHost = "crmy170-postgres";

export function sharingDatabase(env: NodeJS.ProcessEnv, createOwned: () => string): SharingDatabase {
  const supplied = env.CRMY170_TEST_DATABASE_URL;
  if (supplied === undefined) return { url: createOwned(), external: false, database: "crm_crmy170" };
  if (env.CRMY170_EPHEMERAL_TEST !== "true") throw new Error("crmy170_preconfigured_requires_ephemeral_flag");
  let parsed: URL;
  try { parsed = new URL(supplied); } catch { throw new Error("crmy170_preconfigured_url_invalid"); }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) throw new Error("crmy170_preconfigured_protocol_invalid");
  if (parsed.hostname !== sharingDatabaseHost || parsed.port !== "5432") throw new Error("crmy170_preconfigured_host_invalid");
  if (!/^\/crm_crmy170_[a-f0-9]{16}$/.test(parsed.pathname)) throw new Error("crmy170_preconfigured_database_invalid");
  if (parsed.username !== "postgres" || !parsed.password || parsed.search || parsed.hash) throw new Error("crmy170_preconfigured_credentials_or_options_invalid");
  parsed.protocol = "postgresql:";
  return { url: parsed.href, external: true, database: parsed.pathname.slice(1) };
}

interface DatabaseIdentity { database: string; marker: string | null; address: string | null; relations: bigint }

export function verifySharingDatabaseIdentity(database: string, identity: DatabaseIdentity, addresses: readonly string[]): void {
  const privateAddress = (address: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
  if (addresses.length !== 1 || !addresses.every(privateAddress) || identity.address !== addresses[0]) throw new Error("crmy170_preconfigured_connection_ambiguous");
  if (identity.database !== database || identity.marker !== `CRMY170_SYNTHETIC:${database}`) throw new Error("crmy170_preconfigured_marker_missing");
  if (identity.relations !== 0n) throw new Error("crmy170_preconfigured_database_not_empty");
}

export async function verifySharingDatabase(client: PrismaClient, database: string): Promise<void> {
  // No business reads or migration before proving the dedicated empty database.
  let addresses: string[];
  let identities: DatabaseIdentity[];
  try {
    addresses = await resolve4(sharingDatabaseHost);
    identities = await client.$queryRaw<DatabaseIdentity[]>`
      SELECT current_database() AS database,
             shobj_description(oid, 'pg_database') AS marker,
             host(inet_server_addr()) AS address,
             (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema')
                AND n.nspname !~ '^pg_(toast_)?temp_[0-9]+$') AS relations
      FROM pg_database WHERE datname = current_database()`;
  } catch { throw new Error("crmy170_preconfigured_identity_unavailable"); }
  const identity = identities[0];
  if (identities.length !== 1 || !identity) throw new Error("crmy170_preconfigured_connection_ambiguous");
  verifySharingDatabaseIdentity(database, identity, addresses);
}
