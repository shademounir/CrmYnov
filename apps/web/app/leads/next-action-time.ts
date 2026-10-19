const civilFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function civil(instant: number): string {
  const parts = civilFormatter.formatToParts(new Date(instant));
  const p = (name: string): string => parts.find(part => part.type === name)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}`;
}

/** A civil Casablanca input, independent of the workstation's timezone.
 * Nonexistent or repeated civil times are refused instead of guessed. */
export function casablancaNextActionIso(value: string): string {
  if (!value) return "";
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return value;
  const expected = value.length === 16 ? `${value}:00` : value;
  const base = Date.parse(`${expected}Z`);
  if (!Number.isFinite(base)) return value;
  const matches: number[] = [];
  for (let offset = -180; offset <= 180; offset += 15) {
    const candidate = base + offset * 60_000;
    if (civil(candidate) === expected) matches.push(candidate);
  }
  return matches.length === 1 ? new Date(matches[0]!).toISOString() : value;
}
