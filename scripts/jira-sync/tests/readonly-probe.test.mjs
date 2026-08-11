import assert from "node:assert/strict";
import test from "node:test";
import { runReadonlyProbe } from "../readonly-probe.mjs";

const config = {
  baseUrl: "https://mounirbaali-1778581315657.atlassian.net",
  cloudId: "",
  userEmail: "mounir.baali50@ynov.com",
  apiToken: "synthetic-token",
  projectKey: "CRMY",
  enabled: false,
  dryRun: true,
  allowedActors: ["shademounir"],
};

const permissionBody = {
  permissions: {
    BROWSE_PROJECTS: { havePermission: true },
    ADD_COMMENTS: { havePermission: true },
    TRANSITION_ISSUES: { havePermission: true },
    ADMINISTER: { havePermission: false },
    ADMINISTER_PROJECTS: { havePermission: false },
    DELETE_ISSUES: { havePermission: false },
    DELETE_ALL_COMMENTS: { havePermission: false },
    DELETE_OWN_COMMENTS: { havePermission: false },
  },
};

const catalogBody = {
  permissions: Object.fromEntries(Object.keys(permissionBody.permissions).map((key) => [key, { key }])),
};

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function successfulBody(url) {
  if (url.endsWith("/myself")) return { active: true, accountType: "atlassian", emailAddress: config.userEmail };
  if (url.endsWith("/permissions")) return catalogBody;
  if (url.includes("/project/")) return { key: "CRMY" };
  if (url.includes("/mypermissions")) return permissionBody;
  if (url.includes("/transitions")) return { transitions: [{ id: "31", name: "Terminer", to: { id: "10107", name: "Done" } }] };
  if (url.includes("/issue/CRMY-111")) {
    return { key: "CRMY-111", fields: { status: { statusCategory: { key: "indeterminate" } }, labels: [], issuetype: { name: "Bug" }, issuelinks: [] } };
  }
  throw new Error(`unexpected synthetic URL: ${url}`);
}

test("classic token succeeds first and uses GET without redirects", async () => {
  const calls = [];
  const result = await runReadonlyProbe(config, async (url, options) => {
    calls.push({ url: String(url), options });
    return response(200, successfulBody(String(url)));
  });
  assert.equal(result.mode, "classic");
  assert.equal(result.cloudId, null);
  assert.equal(result.mutated, false);
  assert.ok(calls.every((call) => call.options.method === "GET" && call.options.redirect === "manual"));
  assert.ok(calls.every((call) => call.url.startsWith(config.baseUrl)));
  const permissionsUrl = new URL(calls.find((call) => call.url.includes("/mypermissions?")).url);
  assert.equal(permissionsUrl.searchParams.get("issueKey"), "CRMY-111");
  assert.equal(permissionsUrl.searchParams.has("projectKey"), false);
  assert.equal(permissionsUrl.searchParams.get("permissions"), Object.keys(permissionBody.permissions).join(","));
  assert.match(permissionsUrl.search, /permissions=[^&]*%2C/);
  assert.deepEqual(result.permissions.notVerifiableByEndpoint, []);
  assert.deepEqual(result.transitions.available, [{ id: "31", name: "Terminer", destination: { id: "10107", name: "Done" } }]);
});

test("scoped token is attempted only after classic 401 with validated tenant UUID", async () => {
  const cloudId = "80fb4313-ab5c-42ac-a082-d016c237af5d";
  const calls = [];
  const result = await runReadonlyProbe(config, async (url, options) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value === `${config.baseUrl}/rest/api/3/myself`) return response(401, {});
    if (value === `${config.baseUrl}/_edge/tenant_info`) return response(200, { cloudId });
    return response(200, successfulBody(value));
  });
  assert.equal(result.mode, "scoped");
  assert.equal(result.cloudId, cloudId);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.ok(calls.slice(2).every((call) => call.url.startsWith(`https://api.atlassian.com/ex/jira/${cloudId}/`)));
});

test("a redirect is refused without being followed", async () => {
  await assert.rejects(
    runReadonlyProbe(config, async () => response(302, {}, { location: "https://example.invalid" })),
    /jira_readonly_probe_redirect_refused/,
  );
});

test("identity mismatch fails closed", async () => {
  const calls = [];
  await assert.rejects(
    runReadonlyProbe(config, async (url) => {
      calls.push(String(url));
      const body = successfulBody(String(url));
      if (String(url).endsWith("/myself")) body.emailAddress = "other@synthetic.invalid";
      return response(200, body);
    }),
    /jira_readonly_probe_identity_mismatch/,
  );
  assert.equal(calls.length, 1);
});

test("missing email in identity fails before permission discovery", async () => {
  const calls = [];
  await assert.rejects(
    runReadonlyProbe(config, async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/myself")) return response(200, { active: true, accountType: "atlassian" });
      return response(200, successfulBody(String(url)));
    }),
    /jira_readonly_probe_identity_mismatch/,
  );
  assert.equal(calls.length, 1);
});

test("catalog intersection ignores unknown keys and classifies unavailable keys", async () => {
  const partialCatalog = { permissions: {
    BROWSE_PROJECTS: { key: "BROWSE_PROJECTS" },
    ADD_COMMENTS: { key: "ADD_COMMENTS" },
    TRANSITION_ISSUES: { key: "TRANSITION_ISSUES" },
    ADMINISTER: { key: "ADMINISTER" },
    SYNTHETIC_UNKNOWN: { key: "SYNTHETIC_UNKNOWN" },
  } };
  const calls = [];
  const result = await runReadonlyProbe(config, async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/permissions")) return response(200, partialCatalog);
    return response(200, successfulBody(String(url)));
  });
  const query = new URL(calls.find((call) => call.url.includes("/mypermissions?")).url).searchParams.get("permissions");
  assert.equal(query, "BROWSE_PROJECTS,ADD_COMMENTS,TRANSITION_ISSUES,ADMINISTER");
  assert.equal(query.includes("SYNTHETIC_UNKNOWN"), false);
  assert.deepEqual(result.permissions.notVerifiableByEndpoint, [
    "ADMINISTER_PROJECTS", "DELETE_ISSUES", "DELETE_ALL_COMMENTS", "DELETE_OWN_COMMENTS",
  ]);
});

test("an empty catalogue intersection fails closed before mypermissions", async () => {
  const calls = [];
  await assert.rejects(
    runReadonlyProbe(config, async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/permissions")) return response(200, { permissions: { UNKNOWN: {} } });
      return response(200, successfulBody(String(url)));
    }),
    /jira_readonly_probe_permission_query_empty/,
  );
  assert.equal(calls.some((url) => url.includes("/mypermissions")), false);
});

test("required permission absent from catalogue fails closed as not verifiable", async () => {
  const partialCatalog = structuredClone(catalogBody);
  delete partialCatalog.permissions.ADD_COMMENTS;
  await assert.rejects(
    runReadonlyProbe(config, async (url) => response(200,
      String(url).endsWith("/permissions") ? partialCatalog : successfulBody(String(url)))),
    /jira_readonly_probe_required_permission_missing/,
  );
});

test("Jira 400 diagnostics are bounded and redact sensitive fields", async () => {
  let rejection;
  try {
    await runReadonlyProbe(config, async (url) => {
      if (String(url).includes("/mypermissions?")) {
        return response(400, {
          errorMessages: ["invalid for person@example.com https://example.invalid/path?token=secret"],
          errors: { accountId: "accountId=unsafe-identifier", field: "bad" },
          ignoredBusinessData: { payload: "must-not-appear" },
        });
      }
      return response(200, successfulBody(String(url)));
    });
  } catch (error) {
    rejection = error;
  }
  assert.equal(rejection?.message, "jira_readonly_probe_http_400");
  const output = JSON.stringify(rejection?.probeResult);
  assert.ok(output.length <= 2048);
  assert.doesNotMatch(output, /person@example\.com|token=secret|must-not-appear|unsafe-identifier/);
  assert.match(output, /redacted-email/);
});

test("missing required and excessive forbidden permissions fail closed", async () => {
  const badPermissions = structuredClone(permissionBody);
  badPermissions.permissions.ADD_COMMENTS.havePermission = false;
  badPermissions.permissions.ADMINISTER.havePermission = true;
  await assert.rejects(
    runReadonlyProbe(config, async (url) => response(200, String(url).includes("/mypermissions") ? badPermissions : successfulBody(String(url)))),
    /jira_readonly_probe_required_permission_missing/,
  );
});

test("an excessive permission fails closed even when required permissions exist", async () => {
  const badPermissions = structuredClone(permissionBody);
  badPermissions.permissions.ADMINISTER_PROJECTS.havePermission = true;
  await assert.rejects(
    runReadonlyProbe(config, async (url) => response(200, String(url).includes("/mypermissions") ? badPermissions : successfulBody(String(url)))),
    /jira_readonly_probe_forbidden_permission_granted/,
  );
});

test("absence of transitions is reported without mutation", async () => {
  const result = await runReadonlyProbe(config, async (url) => response(200,
    String(url).includes("/transitions") ? { transitions: [] } : successfulBody(String(url))));
  assert.equal(result.transitions.count, 0);
  assert.deepEqual(result.transitions.available, []);
  assert.equal(result.mutated, false);
});

test("unsafe configuration refuses every HTTP request", async () => {
  let called = false;
  await assert.rejects(
    runReadonlyProbe({ ...config, enabled: true, dryRun: true }, async () => { called = true; }),
    /jira_readonly_probe_unsafe_configuration/,
  );
  assert.equal(called, false);
});
