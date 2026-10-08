import { UnprocessableEntityException } from "@nestjs/common";

export const BASELINE_OPTIONAL_INFORMATION = ["program", "educationLevel"] as const;
type OptionalField = typeof BASELINE_OPTIONAL_INFORMATION[number];
type Values = Record<string, string | null>;

/** Absence is not a programme/reference or an educational fact. Only a truly
 * absent literal BASELINE field can remain empty; an unresolved formula or a
 * known value cannot be silently erased by an override. Source evidence stays
 * immutable in the ledger. NEW creation does not use this exception. */
export function baselineOptionalValues(values: Values, source: Values, reasons: readonly string[]): Values {
  const resolved = { ...values };
  for (const field of BASELINE_OPTIONAL_INFORMATION) {
    if (resolved[field]?.trim()) continue;
    if (reasons.includes(`FORMULA_REVIEW:${field}`)) throw new UnprocessableEntityException({ code: "bootstrap_formula_review_required" });
    if (source[field]?.trim()) throw new UnprocessableEntityException({ code: "bootstrap_baseline_known_value_cannot_clear", field });
    resolved[field] = "";
  }
  return resolved;
}

/** The caller must pass the current server/persisted Lead, not client flags.
 * This preserves an existing unknown while forbidding erasure of known facts. */
export function mayPreserveBaselineUnknown(current: { acquisitionKind?: string; program: string; educationLevel: string }, field: OptionalField): boolean {
  return current.acquisitionKind === "BASELINE" && !current[field].trim();
}
