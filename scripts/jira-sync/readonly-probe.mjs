import { loadConfig, safeConfigSummary } from "./config.mjs";

const config = loadConfig();
if (config.enabled || !config.dryRun) {
  throw new Error("jira_readonly_probe_unsafe_configuration");
}
if (!config.baseUrl || !config.userEmail || !config.apiToken) {
  throw new Error("jira_readonly_probe_credentials_missing");
}

const authorization = `Basic ${Buffer.from(
  `${config.userEmail}:${config.apiToken}`,
).toString("base64")}`;

async function get(path) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: authorization },
  });
  if (!response.ok) {
    throw new Error(`jira_readonly_probe_http_${response.status}`);
  }
  return response.json();
}

const projectKey = encodeURIComponent(config.projectKey);
const issueKey = encodeURIComponent("CRMY-111");
const [account, project, issue, permissions, transitions] = await Promise.all([
  get("/rest/api/3/myself"),
  get(`/rest/api/3/project/${projectKey}`),
  get(`/rest/api/3/issue/${issueKey}?fields=status,labels,issuetype,issuelinks`),
  get(`/rest/api/3/mypermissions?projectKey=${projectKey}`),
  get(`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`),
]);

process.stdout.write(
  `${JSON.stringify({
    config: safeConfigSummary(config),
    account: { active: account.active === true, accountType: account.accountType },
    project: { key: project.key },
    issue: { key: issue.key, statusCategory: issue.fields?.status?.statusCategory?.key },
    permissionCount: Object.keys(permissions.permissions ?? {}).length,
    transitionCount: Array.isArray(transitions.transitions)
      ? transitions.transitions.length
      : 0,
    mutated: false,
  })}\n`,
);
