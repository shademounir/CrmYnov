import assert from "node:assert/strict";
import test from "node:test";
import { loadShellReportingAccess, visibleNavigation } from "../app/_components/app-shell.js";

test("pilotage follows server capability without changing a Commercial's administrative navigation", () => {
  for (const role of ["ADMISSIONS", "MANAGER", "AUDITOR"] as const) {
    const links = visibleNavigation([role], { canViewPilotageDashboard: true, canViewPersonalDashboard: true }).map((item) => item.href);
    assert.ok(links.includes("/manager/reports/dashboard"));
    assert.ok(links.includes("/manager/reports/commercial-funnel"));
    assert.ok(links.includes("/manager/reports/commercial-performance?view=global"), "a configured Commercial opens center KPIs, not the legacy personal default");
    assert.ok(!links.includes("/admin/users"));
    assert.ok(!links.includes("/admin/roles"));
  }
  assert.deepEqual(visibleNavigation([], { canViewPilotageDashboard: true, canViewPersonalDashboard: true }), []);
});

test("revocation and unavailable capability hide pilotage even for a Manager or Super Admin", () => {
  for (const role of ["SUPER_ADMIN", "MANAGER", "ADMISSIONS"] as const) {
    const denied = visibleNavigation([role], { canViewPilotageDashboard: false, canViewPersonalDashboard: false }).map((item) => item.href);
    assert.ok(!denied.some((href) => href.startsWith("/manager/reports/")));
    assert.ok(!visibleNavigation([role], null).some((item) => item.href.startsWith("/manager/reports/")));
    const personal = visibleNavigation([role], { canViewPilotageDashboard: false, canViewPersonalDashboard: true }).map((item) => item.href);
    assert.ok(personal.includes("/manager/reports/dashboard?view=personal"));
    assert.ok(personal.includes("/manager/reports/commercial-performance?view=personal"), "a Manager with pilotage revoked retains only the explicitly personal destination");
    assert.ok(!personal.includes("/manager/reports/commercial-funnel"));
  }
});

test("capability transport is read-only, strict and fails closed", async () => {
  for (const status of [200, 401, 403, 503]) {
    const result = await loadShellReportingAccess((input, init) => {
      assert.equal(input, "/api/crm/reports/dashboard/capabilities");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.method, undefined);
      return Promise.resolve(new Response(JSON.stringify({ canViewPilotageDashboard: true, canViewPersonalDashboard: true }), { status }));
    });
    assert.deepEqual(result, status === 200 ? { canViewPilotageDashboard: true, canViewPersonalDashboard: true } : null);
  }
  for (const body of [{ canViewPilotageDashboard: "true" }, { canViewManagerDashboard: true }, null]) {
    assert.equal(await loadShellReportingAccess(() => Promise.resolve(new Response(JSON.stringify(body)))), null);
  }
  assert.equal(await loadShellReportingAccess(() => Promise.reject(new Error("offline"))), null);
});
