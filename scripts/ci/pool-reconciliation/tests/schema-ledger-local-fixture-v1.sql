-- Synthetic local PostgreSQL fixture, never a production migration or grant.
CREATE ROLE crm_migrator LOGIN PASSWORD 'synthetic-local-only';
CREATE ROLE crm_runtime LOGIN PASSWORD 'synthetic-local-only';
CREATE TABLE public._prisma_migrations(migration_name text PRIMARY KEY, checksum text NOT NULL, finished_at timestamptz, rolled_back_at timestamptz);
CREATE TABLE public.synthetic_schema_surface(id text PRIMARY KEY, note text NOT NULL DEFAULT 'synthetic');
CREATE INDEX synthetic_note_idx ON public.synthetic_schema_surface(note);
INSERT INTO public._prisma_migrations VALUES ('20260101000000_synthetic', repeat('a',64), now(), NULL);
GRANT SELECT ON public._prisma_migrations, public.synthetic_schema_surface TO crm_migrator;
GRANT SELECT ON public.synthetic_schema_surface TO crm_runtime;
