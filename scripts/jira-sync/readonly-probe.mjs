import { pathToFileURL } from "node:url";
import { loadConfig, safeConfigSummary } from "./config.mjs";

const EXPECTED_ORIGIN = "https://mounirbaali-1778581315657.atlassian.net";
const SCOPED_ORIGIN = "https://api.atlassian.com";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_PERMISSIONS = ["BROWSE_PROJECTS", "ADD_COMMENTS", "TRANSITION_ISSUES"];
const FORBIDDEN_PERMISSIONS = [
  "ADMINISTER",
  "ADMINISTER_PROJECTS",
  "DELETE_ISSUES",
  "DELETE_ALL_COMMENTS",
  "DELETE_OWN_COMMENTS",
];
const DESIRED_PERMISSIONS = [...REQUIRED_PERMISSIONS, ...FORBIDDEN_PERMISSIONS];
const MAX_DIAGNOSTIC_LENGTH = 1024;

class ProbeHttpError extends Error {
  constructor(status, diagnostic) {
    super(`jira_readonly_probe_http_${status}`);
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

function sanitizeDiagnosticString(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https:\/\/[^\s"']+\?[^\s"']*/gi, "[redacted-url]")
    .replace(/\b(?:accountId|account_id)\s*[:=]\s*[^\s,;}]+/gi, "accountId=[redacted]")
    .replace(/\b\d{5,}:[0-9a-f-]{8,}\b/gi, "[redacted-account-id]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .slice(0, 256);
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return undefined;
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? sanitizeDiagnosticString(value) : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => sanitizeDiagnosticValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, entry]) => [
      sanitizeDiagnosticString(key),
      sanitizeDiagnosticValue(entry, depth + 1),
    ]));
  }
  return undefined;
}

function sanitizeHttpDiagnostic(body, httpStatus) {
  const diagnostic = { status: httpStatus };
  for (const key of ["errorMessages", "errors", "code", "status"]) {
    if (body && Object.hasOwn(body, key)) diagnostic[key] = sanitizeDiagnosticValue(body[key]);
  }
  const serialized = JSON.stringify(diagnostic);
  if (serialized.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return { status: httpStatus, code: "jira_error_diagnostic_truncated" };
}

function validateBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (
    url.origin !== EXPECTED_ORIGIN ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("jira_readonly_probe_base_url_forbidden");
  }
  return url.origin;
}

function validateCloudId(cloudId) {
  const value = String(cloudId ?? "").trim();
  if (!UUID_PATTERN.test(value)) throw new Error("jira_readonly_probe_cloud_id_invalid");
  return value.toLowerCase();
}

function authorizationHeader(config) {
  return `Basic ${Buffer.from(`${config.userEmail}:${config.apiToken}`).toString("base64")}`;
}

function endpoint(base, path) {
  const url = new URL(`${base}${path}`);
  if (url.protocol !== "https:" || ![EXPECTED_ORIGIN, SCOPED_ORIGIN].includes(url.origin)) {
    throw new Error("jira_readonly_probe_endpoint_forbidden");
  }
  if (url.origin === EXPECTED_ORIGIN && !url.pathname.startsWith("/rest/api/3/") && url.pathname !== "/_edge/tenant_info") {
    throw new Error("jira_readonly_probe_endpoint_forbidden");
  }
  if (url.origin === SCOPED_ORIGIN && !/^\/ex\/jira\/[0-9a-f-]+\/rest\/api\/3\//i.test(url.pathname)) {
    throw new Error("jira_readonly_probe_endpoint_forbidden");
  }
  return url;
}

async function jsonGet({ fetchImpl, base, path, authorization, operation, statuses }) {
  const url = endpoint(base, path);
  const headers = { Accept: "application/json" };
  if (authorization) headers.Authorization = authorization;
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers,
  });
  statuses.push({ operation, status: response.status });
  if (response.status >= 300 && response.status < 400) {
    throw Object.assign(new Error("jira_readonly_probe_redirect_refused"), {
      probeResult: { http: [...statuses] },
    });
  }
  if (!response.ok) {
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const diagnostic = sanitizeHttpDiagnostic(body, response.status);
    statuses[statuses.length - 1].diagnostic = diagnostic;
    throw Object.assign(new ProbeHttpError(response.status, diagnostic), {
      probeResult: { http: [...statuses] },
    });
  }
  try {
    return await response.json();
  } catch {
    throw Object.assign(new Error("jira_readonly_probe_json_invalid"), {
      probeResult: { http: [...statuses] },
    });
  }
}

function permissionMatrix(catalogBody, effectiveBody) {
  const catalog = catalogBody?.permissions;
  const effective = effectiveBody?.permissions;
  if (!catalog || typeof catalog !== "object") {
    throw new Error("jira_readonly_probe_permission_catalog_invalid");
  }
  if (!effective || typeof effective !== "object") {
    throw new Error("jira_readonly_probe_permissions_invalid");
  }
  const supported = DESIRED_PERMISSIONS.filter((key) => Object.hasOwn(catalog, key));
  const notVerifiable = DESIRED_PERMISSIONS.filter((key) => !supported.includes(key));
  const required = Object.fromEntries(
    REQUIRED_PERMISSIONS.filter((key) => supported.includes(key))
      .map((key) => [key, effective[key]?.havePermission === true]),
  );
  const forbidden = Object.fromEntries(
    FORBIDDEN_PERMISSIONS.filter((key) => supported.includes(key))
      .map((key) => [key, effective[key]?.havePermission === true]),
  );
  return {
    queried: supported,
    notVerifiableByEndpoint: notVerifiable,
    required,
    forbidden,
    requiredMissing: Object.entries(required).filter(([, value]) => !value).map(([key]) => key),
    requiredNotVerifiable: REQUIRED_PERMISSIONS.filter((key) => notVerifiable.includes(key)),
    forbiddenGranted: Object.entries(forbidden).filter(([, value]) => value).map(([key]) => key),
  };
}

function validateIdentity(account, config, mode, cloudId, statuses) {
  const identity = {
    active: account?.active === true,
    accountType: account?.accountType,
    emailMatchesExpected: account?.emailAddress === config.userEmail,
  };
  if (!identity.active || !identity.emailMatchesExpected) {
    throw Object.assign(new Error("jira_readonly_probe_identity_mismatch"), {
      probeResult: {
        config: safeConfigSummary(config),
        mode,
        cloudId: mode === "scoped" ? cloudId : null,
        account: identity,
        http: [...statuses],
        mutated: false,
      },
    });
  }
  return identity;
}

function blockerKeys(issue) {
  const links = issue?.fields?.issuelinks;
  if (!Array.isArray(links)) throw new Error("jira_readonly_probe_issue_links_invalid");
  return [...new Set(links.flatMap((link) => {
    const inward = String(link?.type?.inward ?? "").trim().toLowerCase();
    const key = String(link?.inwardIssue?.key ?? "").trim().toUpperCase();
    return inward === "is blocked by" && key ? [key] : [];
  }))].sort();
}

async function readBlockers({ keys, get }) {
  if (keys.length === 0) return { keys: [], openCount: 0 };
  const found = new Map();
  const seenTokens = new Set();
  let nextPageToken = null;
  do {
    if (nextPageToken && seenTokens.has(nextPageToken)) {
      throw new Error("jira_readonly_probe_blocker_pagination_loop");
    }
    if (nextPageToken) seenTokens.add(nextPageToken);
    const query = new URLSearchParams({
      jql: `key in (${keys.map((key) => `\"${key}\"`).join(",")})`,
      fields: "status",
      maxResults: "50",
    });
    if (nextPageToken) query.set("nextPageToken", nextPageToken);
    const page = await get(`/rest/api/3/search/jql?${query}`, "blockers");
    if (!Array.isArray(page?.issues) || typeof page?.isLast !== "boolean") {
      throw new Error("jira_readonly_probe_blocker_page_invalid");
    }
    for (const issue of page.issues) {
      const key = String(issue?.key ?? "").toUpperCase();
      const category = String(issue?.fields?.status?.statusCategory?.key ?? "").toLowerCase();
      if (!keys.includes(key) || !category) {
        throw new Error("jira_readonly_probe_blocker_status_invalid");
      }
      found.set(key, category);
    }
    nextPageToken = page.isLast ? null : page.nextPageToken;
    if (!page.isLast && !nextPageToken) {
      throw new Error("jira_readonly_probe_blocker_pagination_incomplete");
    }
  } while (nextPageToken);
  if (found.size !== keys.length) throw new Error("jira_readonly_probe_blocker_inaccessible");
  return { keys, openCount: [...found.values()].filter((value) => value !== "done").length };
}

export async function runReadonlyProbe(config, fetchImpl = globalThis.fetch) {
  if (config.enabled || !config.dryRun) throw new Error("jira_readonly_probe_unsafe_configuration");
  if (!config.baseUrl || !config.userEmail || !config.apiToken) {
    throw new Error("jira_readonly_probe_credentials_missing");
  }
  if (config.projectKey !== "CRMY") throw new Error("jira_readonly_probe_project_forbidden");

  const classicBase = validateBaseUrl(config.baseUrl);
  const authorization = authorizationHeader(config);
  const statuses = [];
  let mode = "classic";
  let cloudId = null;
  let apiBase = classicBase;
  let account;

  try {
    account = await jsonGet({ fetchImpl, base: apiBase, path: "/rest/api/3/myself", authorization, operation: "identity_classic", statuses });
  } catch (error) {
    if (!(error instanceof ProbeHttpError) || error.status !== 401) throw error;
    const tenant = await jsonGet({ fetchImpl, base: classicBase, path: "/_edge/tenant_info", authorization: null, operation: "tenant", statuses });
    cloudId = validateCloudId(tenant?.cloudId);
    if (config.cloudId && validateCloudId(config.cloudId) !== cloudId) {
      throw new Error("jira_readonly_probe_cloud_id_mismatch");
    }
    mode = "scoped";
    apiBase = `${SCOPED_ORIGIN}/ex/jira/${cloudId}`;
    account = await jsonGet({ fetchImpl, base: apiBase, path: "/rest/api/3/myself", authorization, operation: "identity_scoped", statuses });
  }

  const identity = validateIdentity(account, config, mode, cloudId, statuses);
  const get = (path, operation) => jsonGet({ fetchImpl, base: apiBase, path, authorization, operation, statuses });
  const projectKey = encodeURIComponent(config.projectKey);
  const issueKey = encodeURIComponent("CRMY-111");
  const permissionCatalog = await get("/rest/api/3/permissions", "permission_catalog");
  const supportedPermissions = DESIRED_PERMISSIONS.filter((key) =>
    Object.hasOwn(permissionCatalog?.permissions ?? {}, key));
  if (supportedPermissions.length === 0) {
    throw Object.assign(new Error("jira_readonly_probe_permission_query_empty"), {
      probeResult: { config: safeConfigSummary(config), mode, account: identity, http: [...statuses], mutated: false },
    });
  }
  const permissionQuery = new URLSearchParams({
    permissions: supportedPermissions.join(","),
    issueKey: "CRMY-111",
  });
  const permissionBody = await get(`/rest/api/3/mypermissions?${permissionQuery}`, "permissions");
  const project = await get(`/rest/api/3/project/${projectKey}`, "project");
  const issue = await get(`/rest/api/3/issue/${issueKey}?fields=status,labels,issuetype,issuelinks`, "issue");
  const transitions = await get(`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`, "transitions");
  const blockers = await readBlockers({ keys: blockerKeys(issue), get });
  const permissions = permissionMatrix(permissionCatalog, permissionBody);
  const transitionList = Array.isArray(transitions?.transitions) ? transitions.transitions : null;
  if (!transitionList) throw new Error("jira_readonly_probe_transitions_invalid");

  const result = {
    config: safeConfigSummary(config),
    mode,
    cloudId: mode === "scoped" ? cloudId : null,
    account: identity,
    project: { key: project?.key, matchesExpected: project?.key === config.projectKey },
    issue: {
      key: issue?.key,
      statusCategory: issue?.fields?.status?.statusCategory?.key,
      blockerCount: blockers.keys.length,
      openBlockerCount: blockers.openCount,
    },
    permissions,
    transitions: {
      count: transitionList.length,
      available: transitionList.map((entry) => ({
        id: String(entry?.id ?? ""),
        name: String(entry?.name ?? "").slice(0, 128),
        destination: {
          id: String(entry?.to?.id ?? ""),
          name: String(entry?.to?.name ?? "").slice(0, 128),
        },
      })),
      administrativeReopenAvailable: transitionList.some((entry) =>
        String(entry?.name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("reouvrir"),
      ),
    },
    http: statuses,
    mutated: false,
  };

  if (!result.project.matchesExpected) {
    throw Object.assign(new Error("jira_readonly_probe_project_mismatch"), { probeResult: result });
  }
  if (permissions.requiredMissing.length > 0 || permissions.requiredNotVerifiable.length > 0) {
    throw Object.assign(new Error("jira_readonly_probe_required_permission_missing"), { probeResult: result });
  }
  if (permissions.forbiddenGranted.length > 0 || result.transitions.administrativeReopenAvailable) {
    throw Object.assign(new Error("jira_readonly_probe_forbidden_permission_granted"), { probeResult: result });
  }
  return result;
}

async function main() {
  try {
    const result = await runReadonlyProbe(loadConfig());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ...(error.probeResult ?? {}),
      errorCode: String(error?.message ?? "jira_readonly_probe_failed").startsWith("jira_")
        ? error.message
        : "jira_readonly_probe_failed",
      mutated: false,
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
