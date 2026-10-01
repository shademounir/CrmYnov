import { ForbiddenException } from "@nestjs/common";

/** Never infer an identity from a login identifier. Errors contain no input. */
export function professionalDisplayName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || /\p{Cc}/u.test(value)) {
    throw new ForbiddenException({ code: "professional_display_name_invalid" });
  }
  const normalized = value.trim();
  if (normalized.length > 120) throw new ForbiddenException({ code: "professional_display_name_invalid" });
  return normalized || null;
}
