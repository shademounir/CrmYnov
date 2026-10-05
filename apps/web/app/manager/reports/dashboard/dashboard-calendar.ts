export type DashboardCalendar = Readonly<{
  observedAt: string; timezone: "Africa/Casablanca"; label: string; from: string; to: string;
}>;

/** One server snapshot is serialized to the client; hydration never reads its clock or locale. */
export function dashboardCalendar(instant: Date): DashboardCalendar {
  const timezone = "Africa/Casablanca";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)!.value;
  const from = `${part("year")}-${part("month")}-${part("day")}`;
  // Advance a calendar date, not 24 elapsed hours across a Casablanca offset change.
  const nextDay = new Date(`${from}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    observedAt: instant.toISOString(), timezone, from, to: nextDay.toISOString().slice(0, 10),
    label: new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: timezone }).format(instant),
  };
}
