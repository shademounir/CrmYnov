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
