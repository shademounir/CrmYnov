import InteractiveReportingDashboard from "./reporting-ui";
import { dashboardCalendar } from "./dashboard-calendar";

const allowed = new Set(["period", "from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view", "treatmentFrom", "treatmentTo", "treatmentState"]);

export default async function ManagerReportsDashboardPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const raw = await searchParams;
  const filters = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => allowed.has(key) && typeof value === "string" ? [[key, value]] : []));
  return <InteractiveReportingDashboard key={new URLSearchParams(filters).toString()} initialFilters={filters} initialCalendar={dashboardCalendar(new Date())} />;
}
