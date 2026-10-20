import { casablancaNextActionIso } from "./next-action-time";

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" });
export function casablancaDay(instant: string | Date): string {
  if (!Number.isFinite(new Date(instant).valueOf())) return "";
  const parts = dayFormatter.formatToParts(new Date(instant));
  const part = (key: string): string => parts.find(item => item.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function shiftCivilDay(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== day) throw new Error("added_period_day_invalid");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function addedDayStart(day: string): string {
  shiftCivilDay(day, 0);
  const result = casablancaNextActionIso(`${day}T00:00:00`);
  if (!result.endsWith("Z")) throw new Error("added_period_boundary_unavailable");
  return result;
}
/** Inclusive civil days, frozen into exact exclusive-end instants in the URL. */
export function addedPeriod(start: string, end: string): { from: string; to: string } {
  if (start > end) throw new Error("added_period_range_invalid");
  return { from: addedDayStart(start), to: addedDayStart(shiftCivilDay(end, 1)) };
}
export function addedPreset(days: 1 | 7 | 30, now: Date): { from: string; to: string } {
  const today = casablancaDay(now);
  return addedPeriod(shiftCivilDay(today, 1 - days), today);
}
export function addedAtLabel(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date d’ajout indisponible";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
export function addedPeriodQuery(current: URLSearchParams, period: { from: string; to: string }, directory: boolean): URLSearchParams {
  const next = new URLSearchParams(current);
  if (directory) { next.delete("createdTo"); next.set("createdFrom", period.from); next.set("createdBefore", period.to); next.set("page", "1"); }
  else { next.set("period", "custom"); next.set("from", period.from); next.set("to", period.to); }
  return next;
}
