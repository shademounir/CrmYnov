import { UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";

/** Contact equivalence is deliberately conservative: no country inference,
 * extension concatenation, accent removal or fuzzy person matching. */
export function normalizeHistoricalEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && email.length <= 254 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export function normalizeHistoricalPhone(value: string | null | undefined): string | null {
  const phone = value?.trim();
  if (!phone || !/^\+?[\d ().-]+$/.test(phone)) return null;
  const compact = phone.replace(/[ ().-]/g, "");
  return /^\+?\d{8,15}$/.test(compact) ? compact : null;
}

export function historicalStatusResolutionReason(rawStatus: string | null | undefined): "STATUS_MISSING_REVIEW" | "HISTORICAL_MILESTONE_STATUS_REVIEW" | null {
  if (!rawStatus?.trim()) return "STATUS_MISSING_REVIEW";
  const normalized = rawStatus.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  return ["a qualifier", "rdv planifie", "rdv effectue", "dossier ouvert"].includes(normalized) ? "HISTORICAL_MILESTONE_STATUS_REVIEW" : null;
}
export function requireExplicitHistoricalStatus(reasons: readonly string[], decision: { reason: string; overrides?: { status?: string } }, rawStatus?: string | null): void {
  if ((reasons.some((reason) => ["STATUS_MISSING_REVIEW", "HISTORICAL_MILESTONE_STATUS_REVIEW"].includes(reason)) || (rawStatus !== undefined && historicalStatusResolutionReason(rawStatus) !== null))
    && (!decision.overrides?.status?.trim() || decision.reason.trim().length < 8)) {
    throw new UnprocessableEntityException({ code: "bootstrap_status_explicit_resolution_required" });
  }
}

export const MAX_CONTACT_SCOPE_ROWS = 10000;

/** Mapped keys plus literal source values are conservative reservation signals.
 * Formula/cache/raw metadata are not contacts. No inference or multi-value split. */
export function historicalContactSignals(mapped: unknown, payload: unknown): { emails: string[]; phones: string[] } {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const values = object(object(mapped).values);
  const candidates = [values.email, values.phone, ...Object.values(object(object(payload).cells)).flatMap(raw => {
    const cell = object(raw); return Object.hasOwn(cell, "formula") ? [] : [cell.value];
  })].filter((value): value is string | number => typeof value === "string" || typeof value === "number").map(String);
  return { emails: [...new Set(candidates.flatMap(value => normalizeHistoricalEmail(value) ?? []))], phones: [...new Set(candidates.flatMap(value => normalizeHistoricalPhone(value) ?? []))] };
}

/** Called inside the existing exclusive PostgreSQL permission transaction.
 * Both source surfaces are bounded before normalization; overflow refuses the
 * CREATE instead of treating a partial search as absence. No matching ID is
 * selected or returned, including for an unreadable or retired dossier. */
export async function requireNoHistoricalContactCollision(tx: PermissionTransaction, input: {
  campusId: string; campusKeys: readonly string[]; rowId: string;
  email: string | null; phone: string | null;
}): Promise<void> {
  const [result] = await tx.$queryRaw<Array<{ overflow: boolean; collision: boolean }>>(Prisma.sql`
    WITH scoped_leads AS MATERIALIZED (
      SELECT email, phone FROM leads
      WHERE campus IN (${Prisma.join([...input.campusKeys])})
      LIMIT ${MAX_CONTACT_SCOPE_ROWS + 1}
    ), scoped_decisions AS MATERIALIZED (
      SELECT r.decision->'values'->>'email' AS email, r.decision->'values'->>'phone' AS phone
      FROM bootstrap_import_rows r JOIN bootstrap_import_packages p ON p.id = r.package_id
      WHERE p.campus_id = ${input.campusId}::uuid AND r.id <> ${input.rowId}::uuid
        AND r.state = 'READY' AND r.decision->>'action' = 'CREATE_DOSSIER'
      LIMIT ${MAX_CONTACT_SCOPE_ROWS + 1}
    ), contacts AS (SELECT email, phone FROM scoped_leads UNION ALL SELECT email, phone FROM scoped_decisions)
    SELECT ((SELECT count(*) FROM scoped_leads) > ${MAX_CONTACT_SCOPE_ROWS}
      OR (SELECT count(*) FROM scoped_decisions) > ${MAX_CONTACT_SCOPE_ROWS}) AS overflow,
      EXISTS (SELECT 1 FROM contacts WHERE
        (${input.email}::text IS NOT NULL AND lower(btrim(email)) = ${input.email}::text)
        OR (${input.phone}::text IS NOT NULL AND btrim(phone) ~ '^[+]?[0-9 ().-]+$'
          AND regexp_replace(btrim(phone), '[ ().-]', '', 'g') = ${input.phone}::text)) AS collision
  `);
  if (!result || result.overflow) throw new UnprocessableEntityException({ code: "bootstrap_contact_scope_review_required" });
  if (result.collision) throw new UnprocessableEntityException({ code: "bootstrap_contact_reconciliation_required" });
}

/** Called inside the existing permission/lease-fenced Serializable Sheet
 * transaction, before any assignment/batch/Lead. No identifiers leave this
 * query, and an incomplete search never means "no collision". A same-name
 * signal is only REVIEW: it is deliberately not an identity merge. */
export async function deferredHistoricalCollision(tx: PermissionTransaction, input: {
  campusId: string; email: string | null; phone: string | null; firstName: string; lastName: string;
}): Promise<"sheet_append_deferred_contact_review" | "sheet_append_deferred_name_review" | "sheet_append_deferred_scope_review" | null> {
  // PostgreSQL's one-argument btrim removes ASCII spaces only. Match the exact
  // ECMAScript TrimString set used by the existing contact/name normalization;
  // do not remove internal whitespace or change the preserved source payload.
  const trimCharacters = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const [result] = await tx.$queryRaw<Array<{ overflow: boolean; contact: boolean; name: boolean }>>(Prisma.sql`
    WITH deferred AS MATERIALIZED (
      SELECT r.mapped->'values'->>'email' AS email, r.mapped->'values'->>'phone' AS phone,
        r.decision->'values'->>'email' AS decided_email, r.decision->'values'->>'phone' AS decided_phone,
        r.mapped->'values'->>'firstName' AS first_name, r.mapped->'values'->>'lastName' AS last_name,
        r.payload->'cells' AS cells
      FROM bootstrap_import_rows r JOIN bootstrap_import_packages p ON p.id=r.package_id
      WHERE p.campus_id=${input.campusId}::uuid AND (r.state='DEFERRED' OR (r.state IN ('REVIEW','READY')
        AND EXISTS (SELECT 1 FROM bootstrap_import_receipts deferred_receipt WHERE deferred_receipt.package_id=r.package_id
          AND deferred_receipt.operation='DEFER_ROW' AND deferred_receipt.response->>'rowId'=r.id::text)))
      LIMIT ${MAX_CONTACT_SCOPE_ROWS + 1}
    )
    SELECT (SELECT count(*) FROM deferred) > ${MAX_CONTACT_SCOPE_ROWS} AS overflow,
      EXISTS (SELECT 1 FROM deferred WHERE
        (${input.email}::text IS NOT NULL AND lower(btrim(email,${trimCharacters}))=${input.email}::text)
        OR (${input.email}::text IS NOT NULL AND lower(btrim(decided_email,${trimCharacters}))=${input.email}::text)
        OR (${input.phone}::text IS NOT NULL AND btrim(phone,${trimCharacters}) ~ '^[+]?[0-9 ().-]+$'
          AND regexp_replace(btrim(phone,${trimCharacters}), '[ ().-]', '', 'g')=${input.phone}::text)
        OR (${input.phone}::text IS NOT NULL AND btrim(decided_phone,${trimCharacters}) ~ '^[+]?[0-9 ().-]+$'
          AND regexp_replace(btrim(decided_phone,${trimCharacters}), '[ ().-]', '', 'g')=${input.phone}::text)
        OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(cells,'{}'::jsonb)) AS source_cell(column_name,cell)
          WHERE NOT (cell ? 'formula') AND jsonb_typeof(cell->'value') IN ('string','number') AND (
            (${input.email}::text IS NOT NULL AND lower(btrim(cell->>'value',${trimCharacters}))=${input.email}::text)
            OR (${input.phone}::text IS NOT NULL AND btrim(cell->>'value',${trimCharacters}) ~ '^[+]?[0-9 ().-]+$'
              AND regexp_replace(btrim(cell->>'value',${trimCharacters}), '[ ().-]', '', 'g')=${input.phone}::text)))) AS contact,
      EXISTS (SELECT 1 FROM deferred WHERE ${input.firstName.trim()}::text<>'' AND ${input.lastName.trim()}::text<>''
        AND btrim(first_name,${trimCharacters})=${input.firstName.trim()}::text AND btrim(last_name,${trimCharacters})=${input.lastName.trim()}::text) AS name
  `);
  if (!result || typeof result.overflow !== "boolean" || typeof result.contact !== "boolean" || typeof result.name !== "boolean" || result.overflow) return "sheet_append_deferred_scope_review";
  if (result.contact) return "sheet_append_deferred_contact_review";
  if (result.name) return "sheet_append_deferred_name_review";
  return null;
}
