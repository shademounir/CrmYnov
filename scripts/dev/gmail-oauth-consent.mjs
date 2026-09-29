/** One-time, local DEV mailbox consent. Never print OAuth credentials or tokens. */
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { OAuth2Client } from "google-auth-library";

const project = "crmynov-dev-n7x4q2";
const sender = "casablancaynovcampus@gmail.com";
const scope = "https://www.googleapis.com/auth/gmail.send";
// Fixed, administrator-owned installations: never resolve an executable from PATH.
const powershell = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const gcloudScript = String.raw`C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1`;
const explorer = String.raw`C:\Windows\explorer.exe`;

function runGcloud(args) {
  return execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-File", gcloudScript, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
}

function secret(name) {
  try { return runGcloud(["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${project}`]); }
  catch { throw new Error(`Required DEV Secret Manager version unavailable: ${name}.`); }
}

function addSecretVersion(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-File", gcloudScript, "secrets", "versions", "add", name, `--project=${project}`, "--data-file=-", "--quiet"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.resume();
    child.stderr.resume();
    child.on("error", () => reject(new Error("Secret Manager write unavailable.")));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Secret Manager rejected the token version.")));
    child.stdin.end(value);
  });
}

export async function runConsent({
  activeAccount = () => runGcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]),
  readSecret = secret,
  storeToken = addSecretVersion,
  oauthFactory = (id, value, redirect) => new OAuth2Client(id, value, redirect),
  openBrowser = (url) => execFile(explorer, [url], (error) => { if (error) process.stderr.write("Could not open the browser; consent has not started.\n"); }),
  output = process.stdout,
  errors = process.stderr,
  timeoutMs = 300_000,
} = {}) {
  if (activeAccount() !== sender) throw new Error("Select the approved DEV mailbox account in gcloud before consent.");
  const clientId = readSecret("crm-dev-gmail-oauth-client-id");
  const clientSecret = readSecret("crm-dev-gmail-oauth-client-secret");
  const state = randomBytes(32).toString("base64url");
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback listener unavailable.");
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const oauth = oauthFactory(clientId, clientSecret, redirectUri);
  const authorizationUrl = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", include_granted_scopes: false, scope: [scope], state });
  output.write("A browser window will request Gmail send-only consent for the approved DEV mailbox. Do not paste any code or token into chat.\n");
  openBrowser(authorizationUrl);
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
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Consent timed out.")), timeoutMs); }),
    ]);
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token || !tokens.scope?.split(/\s+/).includes(scope)) throw new Error("gmail.send refresh grant not confirmed.");
    await storeToken("crm-dev-gmail-oauth-refresh-token", tokens.refresh_token);
    output.write("gmail.send refresh grant stored in DEV Secret Manager. No invitation has been sent.\n");
    return true;
  } catch {
    errors.write("Consent or secure storage failed. No token was printed; the invitation transport remains disabled.\n");
    return false;
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!await runConsent()) process.exitCode = 1;
}
