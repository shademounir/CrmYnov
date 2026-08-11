import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.mjs";
import { JiraClient } from "../jira-client.mjs";

const config = loadConfig({
  JIRA_BASE_URL: "https://jira.synthetic.invalid",
  JIRA_USER_EMAIL: "readonly@synthetic.invalid",
  JIRA_API_TOKEN: "synthetic-credential",
  JIRA_PROJECT_KEY: "CRMY",
  JIRA_SYNC_ENABLED: "false",
  JIRA_SYNC_DRY_RUN: "true",
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "Synthetic response",
    headers: { get: () => null },
    json: async () => body,
  };
}

function blockerLink(key, { direction = "inward", type = "is blocked by" } = {}) {
  const link = { type: { inward: type, outward: "blocks" } };
  link[`${direction}Issue`] = { key };
  return link;
}

function issueBody(links = []) {
  return {
    key: "CRMY-900",
    fields: {
      status: { name: "In Review" },
      labels: ["codex-ready"],
      issuetype: { name: "Task" },
      issuelinks: links,
    },
  };
}

function server({ links = [], pages = [], blockerStatus = 200 } = {}) {
  const calls = [];
  let page = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.includes("/issue/CRMY-900?")) return response(200, issueBody(links));
    if (url.includes("/search/jql?")) {
      if (blockerStatus !== 200) return response(blockerStatus, {});
      return response(200, pages[page++]);
    }
    throw new Error("unexpected_synthetic_request");
  };
  return { fetchImpl, calls };
}

function page(issues, { isLast = true, nextPageToken } = {}) {
  return {
    issues: issues.map(([key, category, name = category]) => ({
      key,
      fields: { status: { name, statusCategory: { key: category } } },
    })),
    isLast,
    ...(nextPageToken ? { nextPageToken } : {}),
  };
}

async function resolve(options) {
  const synthetic = server(options);
  const result = await new JiraClient(config, synthetic.fetchImpl).getIssue("CRMY-900");
  return { result, calls: synthetic.calls };
}

test("ticket without blockers is not blocked", async () => {
  const { result } = await resolve();
  assert.equal(result.blocked, false);
});

for (const [name, category] of [
  ["To Do", "new"],
  ["In Progress", "indeterminate"],
  ["In Review", "indeterminate"],
]) {
  test(`${name} blocker blocks the ticket`, async () => {
    const { result } = await resolve({
      links: [blockerLink("CRMY-1")],
      pages: [page([["CRMY-1", category, name]])],
    });
    assert.equal(result.blocked, true);
  });
}

test("Done blocker does not block the ticket", async () => {
  const { result } = await resolve({
    links: [blockerLink("CRMY-1")],
    pages: [page([["CRMY-1", "done", "Done"]])],
  });
  assert.equal(result.blocked, false);
});

test("custom status in Jira done category does not block", async () => {
  const { result } = await resolve({
    links: [blockerLink("CRMY-1")],
    pages: [page([["CRMY-1", "done", "Released"]])],
  });
  assert.equal(result.blocked, false);
});

test("multiple blockers all in done category do not block", async () => {
  const { result } = await resolve({
    links: [blockerLink("CRMY-1"), blockerLink("CRMY-2")],
    pages: [page([["CRMY-1", "done"], ["CRMY-2", "done"]])],
  });
  assert.equal(result.blocked, false);
});

test("one non-done blocker among several blocks", async () => {
  const { result } = await resolve({
    links: [blockerLink("CRMY-1"), blockerLink("CRMY-2")],
    pages: [page([["CRMY-1", "done"], ["CRMY-2", "new"]])],
  });
  assert.equal(result.blocked, true);
});

test("inaccessible blocker fails closed with sanitized error", async () => {
  const { result } = await resolve({
    links: [blockerLink("CRMY-1")],
    pages: [],
    blockerStatus: 403,
  });
  assert.equal(result.blocked, true);
  assert.equal(result.blockerError, "jira_blocker_authorization");
  assert.equal(JSON.stringify(result).includes("synthetic-credential"), false);
});

test("blocker pagination is completed before evaluation", async () => {
  const { result, calls } = await resolve({
    links: [blockerLink("CRMY-1"), blockerLink("CRMY-2")],
    pages: [
      page([["CRMY-1", "done"]], { isLast: false, nextPageToken: "next" }),
      page([["CRMY-2", "done"]]),
    ],
  });
  assert.equal(result.blocked, false);
  assert.equal(calls.filter((call) => call.url.includes("/search/jql?")).length, 2);
});

test("incomplete pagination fails closed", async () => {
  const { result } = await resolve({
    links: [blockerLink("CRMY-1")],
    pages: [page([], { isLast: false })],
  });
  assert.equal(result.blocked, true);
  assert.equal(result.blockerError, "jira_blocker_pagination_incomplete");
});

test("duplicate blocker links are queried once", async () => {
  const { result, calls } = await resolve({
    links: [blockerLink("CRMY-1"), blockerLink("CRMY-1")],
    pages: [page([["CRMY-1", "done"]])],
  });
  assert.equal(result.blocked, false);
  const query = decodeURIComponent(calls.find((call) => call.url.includes("/search/jql?")).url);
  assert.equal(query.match(/CRMY-1/g).length, 1);
});

test("outward blocks direction does not make source ticket blocked", async () => {
  const { result, calls } = await resolve({
    links: [blockerLink("CRMY-1", { direction: "outward" })],
  });
  assert.equal(result.blocked, false);
  assert.equal(calls.length, 1);
});

test("relates-to links are ignored", async () => {
  const { result, calls } = await resolve({
    links: [blockerLink("CRMY-1", { type: "relates to" })],
  });
  assert.equal(result.blocked, false);
  assert.equal(calls.length, 1);
});

test("missing status category fails closed", async () => {
  const { result } = await resolve({
    links: [blockerLink("CRMY-1")],
    pages: [{ issues: [{ key: "CRMY-1", fields: { status: { name: "Done" } } }], isLast: true }],
  });
  assert.equal(result.blocked, true);
  assert.equal(result.blockerError, "jira_blocker_status_category_missing");
});

test("partial primary issue response fails closed", async () => {
  const fetchImpl = async () => response(200, { key: "CRMY-900", fields: {} });
  const result = await new JiraClient(config, fetchImpl).getIssue("CRMY-900");
  assert.equal(result.blocked, true);
  assert.equal(result.blockerError, "jira_issue_response_incomplete");
});

test("CRMY-108 blocking downstream tickets does not block CRMY-108", async () => {
  const { result } = await resolve({
    links: [
      blockerLink("CRMY-28", { direction: "outward" }),
      blockerLink("CRMY-29", { direction: "outward" }),
      blockerLink("CRMY-31", { direction: "outward" }),
    ],
  });
  assert.equal(result.blocked, false);
});

test("blocker resolution and dry-run use GET only", async () => {
  const { calls } = await resolve({
    links: [blockerLink("CRMY-1")],
    pages: [page([["CRMY-1", "done"]])],
  });
  assert.deepEqual([...new Set(calls.map((call) => call.method))], ["GET"]);
});
