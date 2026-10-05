import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import InteractiveReportingDashboard from "../app/manager/reports/dashboard/reporting-ui.js";
import { dashboardCalendar } from "../app/manager/reports/dashboard/dashboard-calendar.js";

test("dashboard calendar uses Casablanca's calendar day and exclusive next-day boundary", () => {
  // IANA 2026c includes Morocco's return to +00 on 2026-09-20; an old browser
  // database can still produce the next day at the original CI instant 23:53 UTC.
  const ciInstant = dashboardCalendar(new Date("2026-10-04T23:53:00.000Z"));
  const afterMidnight = dashboardCalendar(new Date("2026-10-05T00:00:01.000Z"));
  assert.deepEqual(ciInstant, { observedAt: "2026-10-04T23:53:00.000Z", timezone: "Africa/Casablanca", label: "dimanche 4 octobre 2026", from: "2026-10-04", to: "2026-10-05" });
  assert.deepEqual(afterMidnight, { observedAt: "2026-10-05T00:00:01.000Z", timezone: "Africa/Casablanca", label: "lundi 5 octobre 2026", from: "2026-10-05", to: "2026-10-06" });
  assert.equal(dashboardCalendar(new Date("2026-08-24T23:00:01.000Z")).from, "2026-08-25", "The implementation must not replace Casablanca with a fixed UTC offset");
});

test("serialized server calendar hydrates without recomputing dates across timezone and midnight changes", async (t) => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "UTC";
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-04T23:59:59.000Z") });
  const serverSnapshot = dashboardCalendar(new Date());
  const props = { initialFilters: { period: "7d" }, initialCalendar: JSON.parse(JSON.stringify(serverSnapshot)) as typeof serverSnapshot };
  const html = renderToString(createElement(InteractiveReportingDashboard, props));
  assert.match(html, /dimanche 4 octobre 2026/u);
  const dom = new JSDOM(`<!doctype html><div id="root">${html}</div>`, { url: "https://crm.example.invalid/manager/reports/dashboard" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"); const { hydrateRoot } = await import("react-dom/client");
  const errors: unknown[] = []; let root: ReturnType<typeof hydrateRoot> | undefined;
  t.after(() => {
    if (root) act(() => root!.unmount()); dom.window.close(); t.mock.timers.reset();
    if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone;
    for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  });
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ canUseAgenda: false }, { status: 503 })));
  // The client clock has crossed Casablanca midnight and its host timezone is different.
  process.env.TZ = "Pacific/Honolulu"; t.mock.timers.tick(2_000);
  assert.equal(new Date().toISOString(), "2026-10-05T00:00:01.000Z");
  assert.notEqual(dashboardCalendar(new Date()).label, serverSnapshot.label);
  // Simulate an incompatible client ICU database: the serialized labels/bounds
  // must be used verbatim, without calling the client's date formatter at all.
  t.mock.method(Intl, "DateTimeFormat", (): never => { throw new Error("Client timezone data must not recompute the SSR calendar"); });
  await act(async () => {
    root = hydrateRoot(dom.window.document.getElementById("root")!, createElement(InteractiveReportingDashboard, props), { onRecoverableError: (error) => { errors.push(error); } });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(errors, [], "Hydration errors must remain visible, not suppressed");
  assert.equal(dom.window.document.querySelector(".ui-page-header__eyebrow")?.textContent, serverSnapshot.label);
  assert.equal(dom.window.document.querySelector(".period-selector a")?.getAttribute("href"), "/manager/reports/dashboard?period=custom&from=2026-10-04&to=2026-10-05");
});
