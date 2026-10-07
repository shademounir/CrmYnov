import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

function isolatedOrigin(baseURL: string | undefined): string {
  const url = new URL(baseURL ?? "http://localhost:3000");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("csrf_recipe_requires_isolated_loopback_web");
  return url.origin;
}

test("same-site foreign-port form cannot clear the CRM's Strict session cookies", async ({ page, context, baseURL }) => {
  const origin = isolatedOrigin(baseURL);
  const target = new URL(origin);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end(`<html><body><form method="post" action="${origin}/api/logout"><button type="submit">Synthetic foreign form</button></form></body></html>`);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, target.hostname.replace(/^\[|\]$/gu, ""), resolve); });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("isolated_foreign_origin_unavailable");
    const foreign = `${target.protocol}//${target.hostname}:${address.port}`;
    await context.addCookies([{ name: "crm_session", value: "synthetic-csrf-session", url: origin, httpOnly: true, sameSite: "Strict" }]);
    await page.goto(foreign);
    const submitted = page.waitForRequest((request) => request.url() === `${origin}/api/logout` && request.method() === "POST");
    const refusal = page.waitForResponse((response) => response.url() === `${origin}/api/logout`);
    await page.getByRole("button", { name: "Synthetic foreign form" }).click();
    const headers = await (await submitted).allHeaders();
    expect(headers.origin).toBe(foreign);
    expect(headers["sec-fetch-site"]).toBe("same-site");
    expect(headers.cookie).toContain("crm_session=synthetic-csrf-session");
    const response = await refusal;
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ code: "browser_origin_refused" });
    expect((await context.cookies(origin)).find((cookie) => cookie.name === "crm_session")?.value).toBe("synthetic-csrf-session");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); }));
  }
});

test("real same-origin logout clears synthetic cookies without API access", async ({ page, context, baseURL }) => {
  const origin = isolatedOrigin(baseURL);
  await context.addCookies([
    { name: "crm_session", value: "synthetic-csrf-session", url: origin, httpOnly: true, sameSite: "Strict" },
    { name: "crm_first_login", value: "complete", url: origin, httpOnly: true, sameSite: "Strict" },
  ]);
  await page.goto(`${origin}/api/health`);
  const status = await page.evaluate(async () => (await fetch("/api/logout", { method: "POST", credentials: "same-origin" })).status);
  expect(status).toBe(200);
  expect((await context.cookies(origin)).filter((cookie) => ["crm_session", "crm_first_login"].includes(cookie.name))).toEqual([]);
});

test("real BFF rejects unverified origins and simple content types before any API call", async ({ request, baseURL }) => {
  const origin = isolatedOrigin(baseURL);
  const absent = await request.post(`${origin}/api/crm/sessions`, { data: {}, headers: { "content-type": "application/json" } });
  expect(absent.status()).toBe(403);
  expect(await absent.json()).toEqual({ code: "browser_origin_refused" });
  for (const path of ["sessions", "invitations/completions", "access-recovery/requests", "access-recovery/completions", "leads"]) {
    const refused = await request.post(`${origin}/api/crm/${path}`, { data: "{}", headers: { origin, "content-type": "text/plain" } });
    expect(refused.status()).toBe(415);
    expect(await refused.json()).toEqual({ code: "request_json_required" });
  }
});

test("real browser bodyless POST and DELETE reach the session guard rather than JSON refusal", async ({ page, context, baseURL }) => {
  const origin = isolatedOrigin(baseURL);
  await context.clearCookies();
  await page.goto(`${origin}/api/health`);
  for (const [path, method] of [["calls/synthetic/end", "POST"], ["lead-views/synthetic", "DELETE"]] as const) {
    const sent = page.waitForRequest((request) => request.url() === `${origin}/api/crm/${path}` && request.method() === method);
    const result = await page.evaluate(async ({ path, method }) => {
      const response = await fetch(`/api/crm/${path}`, { method, credentials: "same-origin" });
      const body: unknown = await response.json();
      return { status: response.status, body };
    }, { path, method });
    const request = await sent;
    const headers = await request.allHeaders();
    expect(request.postData()).toBeNull();
    expect(headers.origin).toBe(origin);
    expect(headers["sec-fetch-site"]).toBe("same-origin");
    expect(headers["content-type"]).toBeUndefined();
    expect(result).toEqual({ status: 401, body: { code: "authentication_required" } });
  }
});
