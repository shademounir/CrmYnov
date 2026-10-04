import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";

const syntheticBooking = { id: "appointment-synthetic", leadId: "lead-synthetic", leadIdentifier: "LD-SYNTHETIC", leadLabel: "Lead synthétique", responsibilityId: "responsibility-synthetic", responsibleId: "responsible-synthetic", responsibleLabel: "Responsable synthétique", requesterId: "requester-synthetic", campus: "SYNTHETIC", type: "ENTRETIEN_ADMISSION", mode: "SUR_SITE", state: "PENDING", appointmentState: "PLANIFIE", startsAt: "2099-10-04T09:00:00.000Z", endsAt: "2099-10-04T09:30:00.000Z", durationMinutes: 30, version: 1, canDecide: true, canCancel: true, canReschedule: true } as const;

async function setup(t: TestContext): Promise<{ dom: JSDOM; root: import("react-dom/client").Root; act: typeof import("react").act; createElement: typeof import("react").createElement; settle: () => Promise<void> }> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/appointments/admissions" }); const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true, addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), confirm: (): boolean => false })) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { act, createElement } = await import("react"); const { createRoot } = await import("react-dom/client"); const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  return { dom, root, act, createElement, settle: async (): Promise<void> => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); } };
}

test("Lead booking consumes only declared slots, retains input after refusal and suppresses duplicate submission", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsBookingForm } = await import("../app/appointments/admissions/booking-form");
  let refused = true; let posts = 0; let created = false; const bodies: Record<string, unknown>[] = []; let release: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") { posts += 1; assert.equal(typeof init.body, "string"); bodies.push(JSON.parse(init.body as string) as Record<string, unknown>); if (refused) return Response.json({ code: "admissions_booking_conflict" }, { status: 409 }); await new Promise<void>((resolve) => { release = resolve; }); created = true; return Response.json(syntheticBooking, { status: 201 }); }
    if (path.endsWith("/admissions/context")) return Response.json({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, canUseAgenda: true, campuses: [{ id: "campus", code: "SYNTHETIC", label: "Campus synthétique" }], eligibleUsers: [] });
    if (path.includes("/admissions/responsibles?")) return Response.json({ items: [{ id: "responsibility-synthetic", userId: "responsible-synthetic", label: "Responsable synthétique", campus: "SYNTHETIC", active: true, version: 1 }] });
    if (path.includes("/admissions/bookings?")) return Response.json({ items: created ? [syntheticBooking] : [] });
    if (path.includes("/admissions/slots?")) return Response.json({ items: [{ startsAt: syntheticBooking.startsAt, endsAt: syntheticBooking.endsAt }], redacted: true });
    return Response.json({ id: "lead-synthetic", leadCode: "LD-SYNTHETIC", firstName: "Lead", lastName: "synthétique", campus: "SYNTHETIC" });
  });
  act(() => { root.render(createElement(AdmissionsBookingForm, { leadId: "lead-synthetic" })); }); await settle();
  assert.match(dom.window.document.body.textContent ?? "", /Choisissez un responsable/u);
  const responsible = dom.window.document.querySelector<HTMLSelectElement>('select[name="responsibilityId"]')!;
  act(() => { responsible.value = "responsibility-synthetic"; responsible.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); await settle();
  const slot = dom.window.document.querySelector<HTMLInputElement>('input[name="startsAt"]')!; act(() => slot.click());
  const form = dom.window.document.querySelector("form")!;
  act(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); await settle();
  assert.match(dom.window.document.body.textContent ?? "", /Ce créneau n’est plus libre/u); assert.equal(responsible.value, "responsibility-synthetic"); assert.equal(slot.checked, true);
  refused = false;
  act(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); await settle();
  assert.equal(posts, 2); assert.ok(release); release(); await settle();
  assert.equal(bodies[0]!.idempotencyKey, bodies[1]!.idempotencyKey);
  assert.match(dom.window.document.body.textContent ?? "", /réservé en attente de l’acceptation/u);
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
  assert.ok([...dom.window.document.querySelectorAll("a")].some((link) => link.getAttribute("href") === "/appointments/admissions/appointment-synthetic"));
  assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Rendez-vous accepté/u);
});

test("responsible decision focuses its confirmation, Escape returns focus and unauthorized flags hide decisions", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsBookingActions } = await import("../app/appointments/admissions/booking-actions");
  let posts = 0; let refreshes = 0;
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => { assert.equal(path, "/api/crm/admissions/bookings/appointment-synthetic"); assert.equal(init?.method, "PATCH"); assert.equal(typeof init.body, "string"); assert.equal((JSON.parse(init.body as string) as { expectedVersion: number }).expectedVersion, 1); posts += 1; return Promise.resolve(Response.json({ ...syntheticBooking, state: "ACCEPTED", version: 2 })); });
  const updated = async (): Promise<void> => { refreshes += 1; await Promise.resolve(); };
  act(() => root.render(createElement(AdmissionsBookingActions, { booking: syntheticBooking, onUpdated: updated })));
  const accept = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Accepter le rendez-vous")!;
  act(() => accept.click()); assert.equal(dom.window.document.activeElement?.textContent, "Confirmer cette action");
  const form = dom.window.document.querySelector("form")!; act(() => form.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await settle();
  assert.equal(dom.window.document.querySelector("form"), null); assert.equal(dom.window.document.activeElement, accept);
  act(() => accept.click()); const confirmation = dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  act(() => { confirmation.click(); confirmation.click(); }); await settle(); assert.equal(posts, 1); assert.equal(refreshes, 1);
  assert.match(dom.window.document.body.textContent ?? "", /Rendez-vous accepté par le responsable/u);
  act(() => root.render(createElement(AdmissionsBookingActions, { booking: { ...syntheticBooking, canDecide: false, canCancel: false, canReschedule: false }, onUpdated: updated })));
  assert.equal(dom.window.document.querySelectorAll("button").length, 0);
});

test("private agenda exposes own windows, while a normal requester never receives a declaration form", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgenda } = await import("../app/appointments/admissions/admissions-agenda"); let privateRequests = 0;
  t.mock.method(globalThis, "fetch", (path: string): Promise<Response> => {
    if (path.endsWith("/admissions/context")) return Promise.resolve(Response.json({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, campuses: [{ id: "campus", code: "SYNTHETIC", label: "Campus synthétique" }], eligibleUsers: [] }));
    if (path.endsWith("/admissions/windows")) { privateRequests += 1; return Promise.resolve(Response.json({ items: [] })); }
    return Promise.resolve(Response.json({ items: [{ ...syntheticBooking, canDecide: false, canCancel: true, canReschedule: true }] }));
  });
  act(() => root.render(createElement(AdmissionsAgenda))); await settle();
  assert.equal(privateRequests, 0); assert.equal(dom.window.document.querySelector('input[name="windowStart"]'), null);
  assert.equal(dom.window.document.querySelector('select[name="responsibilityUserId"]'), null);
  assert.match(dom.window.document.body.textContent ?? "", /Aucun profil responsable actif/u);
  assert.match(dom.window.document.body.textContent ?? "", /En attente du responsable/u);
});

test("forbidden context never reveals agenda forms or invented metrics", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgenda } = await import("../app/appointments/admissions/admissions-agenda");
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ code: "permission_denied" }, { status: 403 })));
  act(() => root.render(createElement(AdmissionsAgenda))); await settle();
  assert.match(dom.window.document.body.textContent ?? "", /Accès refusé/u); assert.equal(dom.window.document.querySelectorAll("form").length, 0); assert.equal(dom.window.document.querySelector(".admissions-overview"), null);
});

test("manual window persists only after a server response, retaining the date range on refusal", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsWindowForm } = await import("../app/appointments/admissions/agenda-forms"); let refused = true; let refreshed = 0; const bodies: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => { assert.equal(path, "/api/crm/admissions/windows"); assert.equal(typeof init?.body, "string"); bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>); return Promise.resolve(refused ? Response.json({ code: "admissions_booking_conflict" }, { status: 409 }) : Response.json({ id: "window-synthetic" })); });
  act(() => root.render(createElement(AdmissionsWindowForm, { responsibilities: [{ id: "responsibility-synthetic", userId: "responsible-synthetic", label: "Responsable synthétique", campus: "SYNTHETIC", active: true, version: 1 }], onUpdated: async (): Promise<void> => { refreshed += 1; await Promise.resolve(); } })));
  const setValue = (name: string, value: string): void => { const input = dom.window.document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!; Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); };
  act(() => { setValue("windowStart", "2099-10-04T10:00"); setValue("windowEnd", "2099-10-04T12:00"); });
  const form = dom.window.document.querySelector("form")!;
  act(() => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); await settle();
  assert.match(dom.window.document.body.textContent ?? "", /saisie est conservée/u); assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[name="windowStart"]')!.value, "2099-10-04T10:00"); assert.equal(refreshed, 0);
  refused = false; act(() => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); await settle(); assert.equal(refreshed, 1); assert.equal(bodies[0]!.idempotencyKey, bodies[1]!.idempotencyKey); assert.match(dom.window.document.body.textContent ?? "", /Disponibilité enregistrée et relue/u);
});

test("administration selects only eligible activated campus users and does not fabricate a broad role", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsResponsibilities } = await import("../app/appointments/admissions/agenda-forms"); let body: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => { assert.equal(path, "/api/crm/admissions/responsibles"); assert.equal(typeof init?.body, "string"); body = JSON.parse(init!.body as string) as Record<string, unknown>; return Promise.resolve(Response.json({ id: "responsibility-synthetic" })); });
  const context = { timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: true, canUseAgenda: true, campuses: [{ id: "campus-synthetic", code: "SYNTHETIC", label: "Campus synthétique", canManageResponsibilities: true }], eligibleUsers: [{ id: "user-synthetic", label: "Utilisateur activé", campus: "SYNTHETIC" }] };
  act(() => root.render(createElement(AdmissionsResponsibilities, { context, items: [], onUpdated: async (): Promise<void> => { await Promise.resolve(); } })));
  const campus = dom.window.document.querySelector<HTMLSelectElement>('select[name="responsibilityCampus"]')!; const user = dom.window.document.querySelector<HTMLSelectElement>('select[name="responsibilityUserId"]')!;
  assert.equal(user.disabled, true); act(() => { campus.value = "SYNTHETIC"; campus.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.equal(user.options.length, 2); act(() => { user.value = "user-synthetic"; user.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  act(() => dom.window.document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); await settle();
  assert.deepEqual({ ...body, idempotencyKey: undefined }, { userId: "user-synthetic", campus: "SYNTHETIC", active: true, expectedVersion: 0, idempotencyKey: undefined });
  assert.match(dom.window.document.body.textContent ?? "", /Responsable désigné et relu/u);
});

test("agenda entry follows a current effective grant instead of a role name", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgendaLink } = await import("../app/appointments/admissions/agenda-link"); let allowed = false;
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ canUseAgenda: allowed })));
  act(() => root.render(createElement(AdmissionsAgendaLink, { key: "denied" }))); await settle(); assert.equal(dom.window.document.querySelector("a"), null);
  allowed = true; act(() => root.render(createElement(AdmissionsAgendaLink, { key: "allowed" }))); await settle(); assert.equal(dom.window.document.querySelector("a")?.getAttribute("href"), "/appointments/admissions");
});

for (const scenario of [
  { name: "global administrator with two managed campuses and no eligible users", campuses: [{ code: "SYNTHETIC", manage: true }, { code: "CASABLANCA_YNOV", manage: true }], canManage: true },
  { name: "campus-bounded administrator", campuses: [{ code: "SYNTHETIC", manage: true }], canManage: true },
  { name: "mixed management and agenda-use grants", campuses: [{ code: "SYNTHETIC", manage: true }, { code: "CASABLANCA_YNOV", manage: false }], canManage: true },
  { name: "agenda-use grants without administration", campuses: [{ code: "SYNTHETIC", manage: false }], canManage: false },
  { name: "older context without per-campus management capabilities", campuses: [{ code: "SYNTHETIC", manage: undefined }], canManage: true },
]) {
  test(`agenda bounds responsible reads and administration options for ${scenario.name}`, async (t) => {
    const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgenda } = await import("../app/appointments/admissions/admissions-agenda"); const reads: string[] = [];
    const campuses = scenario.campuses.map(({ code, manage }) => ({ id: `campus-${code}`, code, label: `Campus ${code}`, ...(manage === undefined ? {} : { canManageResponsibilities: manage }) }));
    t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => {
      assert.equal(init?.method, undefined);
      const url = new URL(path, "http://localhost");
      if (url.pathname.endsWith("/admissions/context")) return Promise.resolve(Response.json({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: scenario.canManage, canUseAgenda: true, campuses, eligibleUsers: [] }));
      if (url.pathname.endsWith("/admissions/responsibles")) {
        const campus = url.searchParams.get("campus");
        if (!campus) return Promise.resolve(Response.json({ code: "admissions_invalid" }, { status: 400 }));
        assert.ok(scenario.campuses.some((item) => item.code === campus && item.manage)); reads.push(campus);
        return Promise.resolve(Response.json({ items: [
          { id: `responsible-${campus}`, userId: `user-${campus}`, label: `Responsable ${campus}`, campus, active: true, version: 1 },
          { id: `retired-${campus}`, userId: `retired-user-${campus}`, label: `Profil désactivé ${campus}`, campus, active: false, version: 2 },
          { id: "outside-profile", userId: "outside-user", label: "Profil hors périmètre", campus: "OUTSIDE", active: false, version: 1 },
        ] }));
      }
      return Promise.resolve(Response.json({ items: [] }));
    });
    act(() => root.render(createElement(AdmissionsAgenda))); await settle();
    const managed = scenario.canManage ? scenario.campuses.filter((item) => item.manage).map((item) => item.code) : [];
    assert.deepEqual(reads.sort(), [...managed].sort());
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
    const campus = dom.window.document.querySelector<HTMLSelectElement>('select[name="responsibilityCampus"]');
    assert.deepEqual(campus ? [...campus.options].map((item) => item.value).filter(Boolean).sort() : [], [...managed].sort());
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Profil hors périmètre/u);
    for (const code of managed) {
      assert.match(dom.window.document.body.textContent ?? "", new RegExp(`Responsable ${code}`, "u"));
      assert.match(dom.window.document.body.textContent ?? "", new RegExp(`Profil désactivé ${code}`, "u"));
    }
    if (!managed.length) assert.equal(campus, null);
  });
}

test("a refused campus-specific responsible read does not expose a partial administration agenda", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgenda } = await import("../app/appointments/admissions/admissions-agenda");
  t.mock.method(globalThis, "fetch", (path: string): Promise<Response> => {
    const url = new URL(path, "http://localhost");
    if (url.pathname.endsWith("/admissions/context")) return Promise.resolve(Response.json({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: true, canUseAgenda: true, campuses: ["SYNTHETIC", "CASABLANCA_YNOV"].map((code) => ({ id: `campus-${code}`, code, label: code, canManageResponsibilities: true })), eligibleUsers: [] }));
    if (url.pathname.endsWith("/admissions/responsibles") && url.searchParams.get("campus") === "CASABLANCA_YNOV") return Promise.resolve(Response.json({ code: "permission_denied" }, { status: 403 }));
    return Promise.resolve(Response.json({ items: [] }));
  });
  act(() => root.render(createElement(AdmissionsAgenda))); await settle();
  assert.match(dom.window.document.body.textContent ?? "", /Accès refusé/u);
  assert.equal(dom.window.document.querySelectorAll("form").length, 0);
  assert.equal(dom.window.document.querySelector(".admissions-overview"), null);
});

test("unmount aborts every campus-specific responsible read and discards late results", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgenda } = await import("../app/appointments/admissions/admissions-agenda");
  const signals: AbortSignal[] = []; const finish: Array<() => void> = [];
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(path, "http://localhost");
    if (url.pathname.endsWith("/admissions/context")) return Promise.resolve(Response.json({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: true, canUseAgenda: true, campuses: ["SYNTHETIC", "CASABLANCA_YNOV"].map((code) => ({ id: `campus-${code}`, code, label: code, canManageResponsibilities: true })), eligibleUsers: [] }));
    if (url.pathname.endsWith("/admissions/responsibles")) {
      assert.ok(init?.signal); signals.push(init.signal);
      return new Promise<Response>((resolve) => { finish.push(() => resolve(Response.json({ items: [] }))); });
    }
    return Promise.resolve(Response.json({ items: [] }));
  });
  act(() => root.render(createElement(AdmissionsAgenda))); await settle();
  assert.equal(signals.length, 2); assert.ok(signals.every((signal) => !signal.aborted));
  act(() => root.unmount()); assert.ok(signals.every((signal) => signal.aborted));
  for (const resolve of finish) resolve(); await settle();
  assert.equal(dom.window.document.body.textContent, "");
});

test("a report is saved once only for the authorized evaluator after a realized meeting", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsReportForm } = await import("../app/appointments/admissions/report-form"); let writes = 0;
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => { assert.equal(path, "/api/crm/admissions/bookings/appointment-synthetic/report"); assert.equal(typeof init?.body, "string"); const body = JSON.parse(init!.body as string) as Record<string, unknown>; assert.equal(body.comment, "Synthétique, sans donnée personnelle."); assert.equal(body.result, "NON_DECIDE"); writes += 1; return Promise.resolve(Response.json({ ...syntheticBooking, reportResult: "NON_DECIDE" })); });
  const updated = async (): Promise<void> => { await Promise.resolve(); };
  act(() => root.render(createElement(AdmissionsReportForm, { booking: { ...syntheticBooking, canWriteReport: false }, onUpdated: updated }))); assert.equal(dom.window.document.querySelector("form"), null);
  act(() => root.render(createElement(AdmissionsReportForm, { booking: { ...syntheticBooking, appointmentState: "REALISE", canWriteReport: true }, onUpdated: updated })));
  dom.window.document.querySelector<HTMLTextAreaElement>('textarea[name="comment"]')!.value = "Synthétique, sans donnée personnelle."; dom.window.document.querySelector<HTMLTextAreaElement>('textarea[name="recommendation"]')!.value = "Recommandation synthétique.";
  const form = dom.window.document.querySelector("form")!; act(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); await settle();
  assert.equal(writes, 1); assert.match(dom.window.document.body.textContent ?? "", /ne constitue pas une décision automatique/u);
});

test("reschedule reads bounded slots and protects an edited reason when closing with Escape", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsBookingActions } = await import("../app/appointments/admissions/booking-actions"); let writes = 0;
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => { assert.ok(path.includes("bookingId=appointment-synthetic")); if (init?.method) writes += 1; return Promise.resolve(Response.json({ items: [] })); });
  act(() => root.render(createElement(AdmissionsBookingActions, { booking: syntheticBooking, onUpdated: async (): Promise<void> => { await Promise.resolve(); } })));
  const opener = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Proposer un autre créneau")!;
  act(() => opener.click()); await settle();
  const reason = dom.window.document.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
  act(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Report synthétique à préserver"); reason.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  const form = dom.window.document.querySelector("form")!; act(() => form.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await settle();
  assert.equal(dom.window.document.querySelector('textarea[name="reason"]'), reason); assert.equal(reason.value, "Report synthétique à préserver"); assert.equal(writes, 0);
  t.mock.method(globalThis, "confirm", (): boolean => true); act(() => form.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await settle();
  assert.equal(dom.window.document.querySelector("form"), null); assert.equal(dom.window.document.activeElement, opener); assert.equal(writes, 0);
});

test("an expired Admissions session requires reconnection and never exposes private windows", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgenda } = await import("../app/appointments/admissions/admissions-agenda");
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ code: "authentication_required" }, { status: 401 })));
  act(() => root.render(createElement(AdmissionsAgenda))); await settle();
  assert.match(dom.window.document.body.textContent ?? "", /session a expiré/u); assert.equal(dom.window.document.querySelectorAll("form").length, 0);
});

test("agenda preserves the opaque page cursor, deduplicates rows and never reports partial counts as global totals", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsAgenda } = await import("../app/appointments/admissions/admissions-agenda"); let nextReads = 0;
  t.mock.method(globalThis, "fetch", (path: string): Promise<Response> => {
    if (path.endsWith("/admissions/context")) return Promise.resolve(Response.json({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, canUseAgenda: true, campuses: [{ id: "campus", code: "SYNTHETIC", label: "Campus synthétique" }], eligibleUsers: [] }));
    const url = new URL(path, "http://localhost"); assert.equal(url.searchParams.get("limit"), "50");
    if (url.searchParams.has("cursor")) { assert.equal(url.searchParams.get("cursor"), "opaque+/cursor=do-not-rebuild"); nextReads += 1; return Promise.resolve(Response.json({ items: [syntheticBooking, { ...syntheticBooking, id: "booking-page-two", leadLabel: "Second Lead synthétique" }], hasMore: false })); }
    return Promise.resolve(Response.json({ items: [syntheticBooking], hasMore: true, nextCursor: "opaque+/cursor=do-not-rebuild" }));
  });
  act(() => root.render(createElement(AdmissionsAgenda))); await settle();
  assert.match(dom.window.document.body.textContent ?? "", /compteurs portent uniquement sur les demandes chargées/u);
  const more = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Charger d’autres demandes")!;
  act(() => { more.click(); more.click(); }); await settle();
  assert.equal(nextReads, 1); assert.equal(dom.window.document.querySelectorAll(".admissions-booking-list > li").length, 2); assert.match(dom.window.document.body.textContent ?? "", /Second Lead synthétique/u);
  assert.equal([...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent === "Charger d’autres demandes"), false);
});

test("Lead pagination and a new reservation cannot race a post-creation list refresh", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsBookingForm } = await import("../app/appointments/admissions/booking-form"); let writes = 0; let nextReads = 0; let releasePage: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") { writes += 1; return Response.json(syntheticBooking, { status: 201 }); }
    if (path.endsWith("/admissions/context")) return Response.json({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, canUseAgenda: true, campuses: [{ id: "campus", code: "SYNTHETIC", label: "Campus synthétique" }], eligibleUsers: [] });
    if (path.includes("/admissions/responsibles?")) return Response.json({ items: [{ id: "responsibility-synthetic", userId: "responsible-synthetic", label: "Responsable synthétique", campus: "SYNTHETIC", active: true, version: 1 }] });
    if (path.includes("/admissions/bookings?")) { const url = new URL(path, "http://localhost"); if (url.searchParams.has("cursor")) { assert.equal(url.searchParams.get("cursor"), "opaque+/lead-page=2"); nextReads += 1; await new Promise<void>((resolve) => { releasePage = resolve; }); return Response.json({ items: [syntheticBooking], hasMore: false }); } return Response.json({ items: [], hasMore: writes === 0, nextCursor: "opaque+/lead-page=2" }); }
    if (path.includes("/admissions/slots?")) return Response.json({ items: [{ startsAt: syntheticBooking.startsAt, endsAt: syntheticBooking.endsAt }], redacted: true });
    return Response.json({ id: "lead-synthetic", leadCode: "LD-SYNTHETIC", firstName: "Lead", lastName: "synthétique", campus: "SYNTHETIC" });
  });
  act(() => root.render(createElement(AdmissionsBookingForm, { leadId: "lead-synthetic" }))); await settle();
  const responsible = dom.window.document.querySelector<HTMLSelectElement>('select[name="responsibilityId"]')!;
  act(() => { responsible.value = "responsibility-synthetic"; responsible.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); await settle();
  act(() => dom.window.document.querySelector<HTMLInputElement>('input[name="startsAt"]')!.click());
  const more = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Charger d’autres demandes de ce Lead")!; const form = dom.window.document.querySelector("form")!;
  act(() => { more.click(); more.click(); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); await settle();
  assert.equal(nextReads, 1); assert.equal(writes, 0); assert.equal(dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
  assert.ok(releasePage); releasePage(); await settle();
  act(() => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); await settle();
  assert.equal(writes, 1); assert.match(dom.window.document.body.textContent ?? "", /réservé en attente de l’acceptation/u);
});

test("a confirmed decision followed by unavailable readback stays confirmed and locks stale actions", async (t) => {
  const { dom, root, act, createElement, settle } = await setup(t); const { AdmissionsBookingActions } = await import("../app/appointments/admissions/booking-actions"); let writes = 0;
  t.mock.method(globalThis, "fetch", () => { writes += 1; return Promise.resolve(Response.json({ ...syntheticBooking, state: "ACCEPTED", version: 2 })); });
  act(() => root.render(createElement(AdmissionsBookingActions, { booking: syntheticBooking, onUpdated: (): Promise<void> => Promise.reject(new Error("synthetic_read_unavailable")) })));
  const accept = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Accepter le rendez-vous")!;
  act(() => accept.click()); act(() => dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()); await settle();
  assert.equal(writes, 1); assert.match(dom.window.document.body.textContent ?? "", /Rendez-vous accepté par le responsable/u); assert.match(dom.window.document.body.textContent ?? "", /relecture est indisponible/u);
  assert.equal(dom.window.document.querySelector(".admissions-feedback")?.getAttribute("role"), "status");
  assert.ok([...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].every((button) => button.disabled));
  act(() => accept.click()); await settle(); assert.equal(writes, 1); assert.equal(dom.window.document.querySelector("form"), null);
});
