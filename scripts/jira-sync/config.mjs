const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new Error(`Invalid boolean configuration value: ${normalized}`);
}

function listValue(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const config = {
    baseUrl: String(env.JIRA_BASE_URL ?? "").replace(/\/+$/, ""),
    cloudId: String(env.JIRA_CLOUD_ID ?? ""),
    userEmail: String(env.JIRA_USER_EMAIL ?? ""),
    apiToken: String(env.JIRA_API_TOKEN ?? ""),
    projectKey: String(env.JIRA_PROJECT_KEY ?? "CRMY").toUpperCase(),
    enabled: booleanValue(env.JIRA_SYNC_ENABLED, false),
    dryRun: booleanValue(env.JIRA_SYNC_DRY_RUN, true),
    allowedActors: listValue(env.JIRA_SYNC_ALLOWED_ACTORS),
  };

  if (!config.enabled && !config.dryRun) {
    throw new Error(
      "Unsafe Jira sync configuration: disabled sync must remain in dry-run mode.",
    );
  }

  return config;
}

export function hasReadCredentials(config) {
  return Boolean(config.baseUrl && config.userEmail && config.apiToken);
}

export function mutationAllowed(config) {
  return config.enabled === true && config.dryRun === false;
}

export function safeConfigSummary(config) {
  return {
    projectKey: config.projectKey,
    enabled: config.enabled,
    dryRun: config.dryRun,
    hasBaseUrl: Boolean(config.baseUrl),
    hasCloudId: Boolean(config.cloudId),
    hasUserEmail: Boolean(config.userEmail),
    hasApiToken: Boolean(config.apiToken),
    allowedActorCount: config.allowedActors.length,
  };
}
