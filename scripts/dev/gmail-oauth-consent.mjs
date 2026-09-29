/** One-time, local DEV mailbox consent. Never print OAuth credentials or tokens. */
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

const project = "crmynov-dev-n7x4q2";
const sender = "casablancaynovcampus@gmail.com";
const scope = "https://www.googleapis.com/auth/gmail.send";

function runGcloud(args) {
  return execFileSync("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
}

function secret(name) {
  try { return runGcloud(["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${project}`]); }
  catch { throw new Error(`Required DEV Secret Manager version unavailable: ${name}.`); }
}

function addSecretVersion(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn("gcloud", ["secrets", "versions", "add", name, `--project=${project}`, "--data-file=-", "--quiet"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.resume();
    child.stderr.resume();
    child.on("error", () => reject(new Error("Secret Manager write unavailable.")));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Secret Manager rejected the token version.")));
    child.stdin.end(value);
  });
}

const active = runGcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
if (active !== sender) throw new Error("Select the approved DEV mailbox account in gcloud before consent.");
const clientId = secret("crm-dev-gmail-oauth-client-id");
const clientSecret = secret("crm-dev-gmail-oauth-client-secret");
const state = randomBytes(32).toString("base64url");
const server = createServer();
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Loopback listener unavailable.");
const redirectUri = `http://127.0.0.1:${address.port}/callback`;
const oauth = new OAuth2Client(clientId, clientSecret, redirectUri);
const authorizationUrl = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", include_granted_scopes: false, scope: [scope], state });
process.stdout.write("A browser window will request Gmail send-only consent for the approved DEV mailbox. Do not paste any code or token into chat.\n");
execFile("explorer.exe", [authorizationUrl], (error) => { if (error) process.stderr.write("Could not open the browser; consent has not started.\n"); });

let timeout;
try {
  const code = await Promise.race([
    new Promise((resolve, reject) => server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      const candidate = url.searchParams.get("state") ?? "";
      const actual = Buffer.from(candidate);
      const expected = Buffer.from(state);
      if (url.pathname !== "/callback" || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" }).end("Consentement invalide.");
        reject(new Error("OAuth state rejected."));
        return;
      }
      if (url.searchParams.has("error") || !url.searchParams.get("code")) {
        response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" }).end("Consentement annule.");
        reject(new Error("Consent was not granted."));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store", "referrer-policy": "no-referrer" }).end("Consentement reçu. Vous pouvez fermer cet onglet.");
      resolve(url.searchParams.get("code"));
    })),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Consent timed out.")), 300_000); }),
  ]);
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token || !tokens.scope?.split(/\s+/).includes(scope)) throw new Error("gmail.send refresh grant not confirmed.");
  await addSecretVersion("crm-dev-gmail-oauth-refresh-token", tokens.refresh_token);
  process.stdout.write("gmail.send refresh grant stored in DEV Secret Manager. No invitation has been sent.\n");
} catch {
  process.stderr.write("Consent or secure storage failed. No token was printed; the invitation transport remains disabled.\n");
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  server.close();
}
