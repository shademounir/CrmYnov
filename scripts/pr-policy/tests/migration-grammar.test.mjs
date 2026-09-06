import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzeMigrationSql } from "../migration-policy.mjs";

const markers = "-- prisma-policy: additive\n-- prisma-policy: ephemeral-only\n-- prisma-policy: rollback-documented\n";
const fk = 'CONSTRAINT "link" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
const table = tail => `CREATE TABLE child (id UUID, parent_id UUID, ${tail});`;
const assess = sql => analyzeMigrationSql(markers + sql);
const migrations = fileURLToPath(new URL("../../../apps/api/prisma/migrations/", import.meta.url));

test("all six exact CRMY-171 SQL files pass without altering their constraints", () => {
  const files = readdirSync(migrations).filter(name => name.startsWith("20260905"));
  assert.equal(files.length, 6);
  for (const name of files) assert.deepEqual(analyzeMigrationSql(readFileSync(`${migrations}/${name}/migration.sql`, "utf8")).reasons, [], name);
});

test("historical classifications remain unchanged (bootstrap intentionally unmarked)", () => {
  const files = readdirSync(migrations).filter(name => name < "20260905" && name !== "migration_lock.toml");
  assert.equal(files.length, 29);
  for (const name of files) assert.equal(analyzeMigrationSql(readFileSync(`${migrations}/${name}/migration.sql`, "utf8")).approved, name !== "00000000000000_bootstrap", name);
});

test("bounded FK grammar recognizes casing, spacing and inline comments", () => {
  for (const sql of [table(fk), table(fk.toLowerCase()), table(fk.replaceAll(" ", "\n\t")), table(fk.replace("ON DELETE", "ON -- bounded comment\n DELETE")), table(fk.replace("ON DELETE RESTRICT ON UPDATE CASCADE", "ON UPDATE CASCADE ON DELETE RESTRICT"))]) assert.equal(assess(sql).approved, true, sql);
});

test("referential action words inside string literals are not executable instructions", () => {
  assert.equal(assess("ALTER TABLE logs ADD COLUMN label TEXT DEFAULT 'DELETE; UPDATE; it''s text -- not a comment';").approved, true);
  assert.equal(assess('ALTER TABLE logs ADD COLUMN "DELETE" TEXT;').approved, true);
});

for (const sql of [
  "DELETE FROM child", "uPdAtE child SET id = 'x'", "DROP TABLE child", "TRUNCATE TABLE child", "INSERT INTO child VALUES (1)",
  "ALTER TABLE child DROP COLUMN id", "ALTER TABLE child ALTER COLUMN id TYPE TEXT", "ALTER TABLE child RENAME TO other", "ALTER TABLE child ALTER COLUMN id SET NOT NULL",
]) test(`destructive statement remains refused after a valid table: ${sql}`, () => {
  for (const prefix of ["", table(fk), `${table(fk)} -- an annotation cannot authorize a write\n`]) assert.equal(assess(prefix + sql + ";").approved, false);
});

for (const tail of [
  fk.replace("DELETE RESTRICT", "DELETE CASCADE"), fk.replace("DELETE RESTRICT", "DELETE SET NULL"), fk.replace("UPDATE CASCADE", "UPDATE RESTRICT"),
  fk + " ON DELETE RESTRICT", fk + " DEFERRABLE", fk + " UPDATE child SET id = 1", fk.replace("REFERENCES", "UNKNOWN"),
  fk.replace('("parent_id")', "(parent_id,)"), fk.replace("ON DELETE RESTRICT", "ON DELETE"), fk.replace("ON UPDATE CASCADE", "ON UPDATE"),
]) test(`unknown or broader FK clause is refused: ${tail}`, () => { assert.equal(assess(table(tail)).approved, false); });

test("recognized actions cannot escape a new-table FK definition", () => {
  for (const sql of [
    `ALTER TABLE existing ADD ${fk};`, `CREATE TABLE IF NOT EXISTS child (id UUID, parent_id UUID, ${fk});`,
    `CREATE TABLE child (id UUID, ${fk}) UPDATE child SET id=1;`,
    `CREATE TABLE child (id UUID, ${fk};`, `CREATE TABLE child (id UUID, ${fk},);`,
    `CREATE TABLE child (id UUID, FOREIGN KEY (id) REFERENCES parent(id) ON /* hidden */ DELETE RESTRICT);`,
    `${table(fk)} /* DELETE hidden */`, "ALTER TABLE child ADD COLUMN a TEXT DEFAULT 'unterminated;", "ALTER TABLE child ADD COLUMN a TEXT DEFAULT $$x$$;",
  ]) assert.equal(assess(sql).approved, false, sql);
});

test("separates a bounded DEFAULT from its same-column numeric CHECK", () => {
  for (const sql of [
    'ALTER TABLE runs ADD COLUMN failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0);',
    'alter\n table runs add\t column failures integer default 0 not null check (failures >= 0);',
    'ALTER TABLE runs ADD COLUMN interval INTEGER DEFAULT 15 CHECK (interval BETWEEN 5 AND 15);',
    'ALTER TABLE runs ADD COLUMN delta INTEGER DEFAULT -1 CHECK (delta > -2);',
    'ALTER TABLE runs ADD COLUMN a JSONB, ADD COLUMN b INTEGER;',
    'ALTER TABLE runs ADD COLUMN at TIMESTAMPTZ(6) NOT NULL DEFAULT now();',
  ]) assert.equal(assess(sql).approved, true, sql);
});

for (const definition of [
  'INTEGER NOT NULL', 'INTEGER DEFAULT', 'INTEGER DEFAULT 0 + 1', 'INTEGER DEFAULT arbitrary()',
  'INTEGER DEFAULT (SELECT 1)', 'INTEGER DEFAULT 0 CHECK ()', 'INTEGER DEFAULT 0 CHECK (other >= 0)',
  'INTEGER DEFAULT 0 CHECK (failures >=)', 'INTEGER DEFAULT 0 CHECK (failures >= 0',
  'INTEGER DEFAULT 0 CHECK (failures >= 0))', 'INTEGER DEFAULT 0 CHECK (failures >= 0 OR true)',
  'INTEGER DEFAULT 0 CHECK (failures BETWEEN 0)', 'INTEGER DEFAULT 0 CHECK (failures BETWEEN 0 AND)',
  'INTEGER DEFAULT 0 CHECK (arbitrary(failures))', 'INTEGER DEFAULT 0 CHECK (failures IN (1,2))',
  'INTEGER DEFAULT 0 CHECK (failures >= 0) NOT VALID', 'INTEGER DEFAULT 0 DEFAULT 1',
  'INTEGER NOT NULL DEFAULT 0 NOT NULL', 'INTEGER CHECK (failures >= 0) CHECK (failures <= 1)',
  'UNKNOWN DEFAULT 0', 'INTEGER DEFAULT true::integer', 'INTEGER REFERENCES parent(id)',
  'INTEGER DEFAULT 0, DROP COLUMN old', 'INTEGER DEFAULT 0; DELETE FROM runs',
]) test(`ADD COLUMN refuses malformed or out-of-grammar expression: ${definition}`, () => {
  assert.equal(assess(`ALTER TABLE runs ADD COLUMN failures ${definition};`).approved, false);
});
