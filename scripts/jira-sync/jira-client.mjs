import {
  hasReadCredentials,
  mutationAllowed,
} from "./config.mjs";
import { plannedCommentToAdf } from "./planned-comment.mjs";

export class JiraHttpError extends Error {
  constructor(status, message, retryAfter = null) {
    super(`Jira request failed (${status}): ${message}`);
    this.name = "JiraHttpError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.category =
      status === 401
        ? "authentication"
        : status === 403
          ? "authorization"
          : status === 404
            ? "not_found"
            : status === 429
              ? "rate_limited"
              : status >= 500
                ? "jira_unavailable"
                : "jira_error";
  }
}

function authorizationHeader(userEmail, apiToken) {
  return `Basic ${Buffer.from(`${userEmail}:${apiToken}`).toString("base64")}`;
}

async function responseError(response) {
  return new JiraHttpError(
    response.status,
    response.statusText || "request rejected",
    response.headers?.get?.("retry-after") ?? null,
  );
}

function blockerKeys(fields) {
  if (!Array.isArray(fields.issuelinks)) {
    throw new Error("jira_issue_links_invalid");
  }

  const keys = [];
  for (const link of fields.issuelinks) {
    const inward = String(link?.type?.inward ?? "").trim().toLowerCase();
    if (inward !== "is blocked by" || !link?.inwardIssue) continue;
    const key = String(link?.inwardIssue?.key ?? "").trim().toUpperCase();
    if (!key) throw new Error("jira_blocker_key_missing");
    keys.push(key);
  }
  return [...new Set(keys)].sort();
}

export class JiraClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async getIssue(issueKey) {
    if (!hasReadCredentials(this.config)) {
      return null;
    }

    const fields = "status,labels,issuetype,issuelinks";
    const response = await this.fetch(
      `${this.config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${fields}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authorizationHeader(
            this.config.userEmail,
            this.config.apiToken,
          ),
        },
      },
    );

    if (!response.ok) throw await responseError(response);
    const body = await response.json();
    if (
      !body?.key ||
      !body?.fields?.status?.name ||
      !body?.fields?.issuetype?.name ||
      !Array.isArray(body?.fields?.labels)
    ) {
      return {
        key: body?.key ?? issueKey,
        status: body?.fields?.status?.name ?? "Unknown",
        labels: Array.isArray(body?.fields?.labels) ? body.fields.labels : [],
        issueType: body?.fields?.issuetype?.name ?? "Unknown",
        blocked: true,
        blockerError: "jira_issue_response_incomplete",
      };
    }

    let blocked = body.fields.labels?.includes("blocked") === true;
    let blockerError = null;
    if (!blocked) {
      try {
        blocked = await this.hasOpenBlocker(blockerKeys(body.fields));
      } catch (error) {
        blocked = true;
        blockerError =
          error instanceof JiraHttpError
            ? `jira_blocker_${error.category}`
            : String(error?.message ?? "jira_blocker_resolution_failed").startsWith(
                  "jira_",
                )
              ? error.message
              : "jira_blocker_resolution_failed";
      }
    }
    return {
      key: body.key,
      status: body.fields.status.name,
      labels: body.fields.labels ?? [],
      issueType: body.fields.issuetype.name,
      blocked,
      blockerError,
    };
  }

  async hasOpenBlocker(keys) {
    if (keys.length === 0) return false;

    const expected = new Set(keys);
    const categories = new Map();
    const seenTokens = new Set();
    let nextPageToken = null;

    do {
      if (nextPageToken && seenTokens.has(nextPageToken)) {
        throw new Error("jira_blocker_pagination_loop");
      }
      if (nextPageToken) seenTokens.add(nextPageToken);

      const parameters = new URLSearchParams({
        jql: `key in (${keys.map((key) => `\"${key}\"`).join(",")})`,
        fields: "status",
        maxResults: "50",
      });
      if (nextPageToken) parameters.set("nextPageToken", nextPageToken);

      const response = await this.fetch(
        `${this.config.baseUrl}/rest/api/3/search/jql?${parameters}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: authorizationHeader(
              this.config.userEmail,
              this.config.apiToken,
            ),
          },
        },
      );
      if (!response.ok) throw await responseError(response);

      const body = await response.json();
      if (!Array.isArray(body?.issues) || typeof body?.isLast !== "boolean") {
        throw new Error("jira_blocker_page_incomplete");
      }
      for (const issue of body.issues) {
        const key = String(issue?.key ?? "").toUpperCase();
        const category = issue?.fields?.status?.statusCategory?.key;
        if (
          !expected.has(key) ||
          typeof category !== "string" ||
          !category.trim()
        ) {
          throw new Error("jira_blocker_status_category_missing");
        }
        categories.set(key, category.toLowerCase());
      }

      nextPageToken = body.isLast ? null : body.nextPageToken;
      if (!body.isLast && !nextPageToken) {
        throw new Error("jira_blocker_pagination_incomplete");
      }
    } while (nextPageToken);

    if (categories.size !== expected.size) {
      throw new Error("jira_blocker_issue_inaccessible");
    }
    return [...categories.values()].some((category) => category !== "done");
  }

  async transition(issueKey, transition, idempotencyKey) {
    if (!mutationAllowed(this.config)) {
      return {
        mutated: false,
        mode: "dry-run",
        issueKey,
        transitionId: transition.id,
        idempotencyKey,
      };
    }

    if (!hasReadCredentials(this.config)) {
      throw new Error("Jira credentials are required before mutation.");
    }

    const response = await this.fetch(
      `${this.config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: authorizationHeader(
            this.config.userEmail,
            this.config.apiToken,
          ),
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ transition: { id: transition.id } }),
      },
    );

    if (!response.ok) throw await responseError(response);
    return {
      mutated: true,
      mode: "active",
      issueKey,
      transitionId: transition.id,
      idempotencyKey,
    };
  }

  async getEventRecord(issueKey, idempotencyKey) {
    if (!hasReadCredentials(this.config)) {
      return null;
    }

    const propertyKey = `crmynov.sync.${idempotencyKey}`;
    const response = await this.fetch(
      `${this.config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(propertyKey)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authorizationHeader(
            this.config.userEmail,
            this.config.apiToken,
          ),
        },
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response);
    const body = await response.json();
    return body.value ?? null;
  }

  async recordEvent(issueKey, idempotencyKey, state, dateUtc) {
    if (!mutationAllowed(this.config)) {
      return {
        mutated: false,
        mode: "dry-run",
        state,
        propertyKey: `crmynov.sync.${idempotencyKey}`,
      };
    }

    const propertyKey = `crmynov.sync.${idempotencyKey}`;
    const response = await this.fetch(
      `${this.config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(propertyKey)}`,
      {
        method: "PUT",
        headers: {
          Accept: "application/json",
          Authorization: authorizationHeader(
            this.config.userEmail,
            this.config.apiToken,
          ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          idempotencyKey,
          state,
          dateUtc,
        }),
      },
    );

    if (!response.ok) throw await responseError(response);
    return { mutated: true, mode: "active", state, propertyKey };
  }

  async addComment(issueKey, plannedComment) {
    if (!mutationAllowed(this.config)) {
      return { mutated: false, mode: "dry-run" };
    }

    const response = await this.fetch(
      `${this.config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: authorizationHeader(
            this.config.userEmail,
            this.config.apiToken,
          ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: plannedCommentToAdf(plannedComment) }),
      },
    );

    if (!response.ok) throw await responseError(response);
    return { mutated: true, mode: "active" };
  }
}
