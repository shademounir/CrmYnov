import assert from "node:assert/strict";
import test from "node:test";
import { runConsent } from "../../dev/gmail-oauth-consent.mjs";

const scope = "https://www.googleapis.com/auth/gmail.send";

function fixture({ callback = "valid", tokens = { refresh_token: "synthetic-refresh-token", scope }, storeToken = async () => {} } = {}) {
  const output = []; const errors = []; const opened = [];
  const dependencies = {
    activeAccount: () => "casablancaynovcampus@gmail.com",
    readSecret: (name) => name.endsWith("client-id") ? "synthetic-client-id" : "synthetic-client-secret",
    storeToken,
    oauthFactory: (_id, _secret, redirect) => ({
      generateAuthUrl: ({ state }) => `https://accounts.example.invalid/consent?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,
      getToken: async (code) => { assert.equal(code, "synthetic-code"); return { tokens }; },
    }),
    openBrowser: (url) => {
      opened.push(url);
      const parsed = new URL(url);
      const redirect = new URL(parsed.searchParams.get("redirect_uri"));
      redirect.searchParams.set("state", callback === "invalid-state" ? "not-the-state" : parsed.searchParams.get("state"));
      if (callback === "cancel") redirect.searchParams.set("error", "access_denied");
      else redirect.searchParams.set("code", "synthetic-code");
      queueMicrotask(() => { void fetch(redirect).catch(() => {}); });
    },
    output: { write: (message) => output.push(message) },
    errors: { write: (message) => errors.push(message) },
    timeoutMs: 1000,
  };
  return { dependencies, output, errors, opened };
}

test("Gmail consent stores a send-only grant without exposing its token", async () => {
  const stored = [];
  const { dependencies, output, errors, opened } = fixture({ storeToken: async (...args) => stored.push(args) });
  assert.equal(await runConsent(dependencies), true);
  assert.deepEqual(stored, [["crm-dev-gmail-oauth-refresh-token", "synthetic-refresh-token"]]);
  assert.equal(opened.length, 1);
  assert.equal(errors.length, 0);
  assert.equal(output.join("").includes("synthetic-refresh-token"), false);
  assert.equal(output.join("").includes("No invitation has been sent"), true);
});

test("Gmail consent rejects an altered state and never stores a grant", async () => {
  let writes = 0;
  const { dependencies, errors } = fixture({ callback: "invalid-state", storeToken: async () => { writes += 1; } });
  assert.equal(await runConsent(dependencies), false);
  assert.equal(writes, 0);
  assert.equal(errors.join("").includes("token"), true);
});

test("Gmail consent rejects cancellation, missing scope and storage failure", async () => {
  for (const configuration of [
    { callback: "cancel" },
    { tokens: { refresh_token: "synthetic-refresh-token", scope: "openid" } },
    { storeToken: async () => { throw new Error("synthetic storage refusal"); } },
  ]) {
    const { dependencies, output } = fixture(configuration);
    assert.equal(await runConsent(dependencies), false);
    assert.equal(output.join("").includes("synthetic-refresh-token"), false);
  }
});

test("Gmail consent refuses the wrong active mailbox before opening a browser", async () => {
  const { dependencies, opened } = fixture();
  dependencies.activeAccount = () => "wrong@example.invalid";
  await assert.rejects(runConsent(dependencies), /approved DEV mailbox/u);
  assert.equal(opened.length, 0);
});
