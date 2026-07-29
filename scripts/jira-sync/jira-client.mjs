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

function isBlocked(fields) {
  if (fields.labels?.includes("blocked")) return true;
  return (fields.issuelinks ?? []).some((link) => {
    const inward = String(link?.type?.inward ?? "").toLowerCase();
    return Boolean(link?.inwardIssue && inward.includes("blocked"));
  });
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
    return {
      key: body.key,
      status: body.fields.status.name,
      labels: body.fields.labels ?? [],
      issueType: body.fields.issuetype.name,
      blocked: isBlocked(body.fields),
    };
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
