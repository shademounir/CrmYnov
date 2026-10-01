import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";

const docker = (args: string[]): string => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, stdio: "pipe", timeout: 60_000 }).trim();

export async function imageRuntime(t: TestContext, component: "api" | "web", configuration: string): Promise<string> {
  const image = process.env[component === "api" ? "CRMY171_API_IMAGE" : "CRMY171_WEB_IMAGE"];
  assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/u, "container proof requires an exact local image identity");
  assert.ok(image);
  assert.equal(docker(["image", "inspect", image, "--format", "{{.Id}}"]), image);
  const name = `crmy171-${component}-proof-${randomUUID()}`;
  const containerPort = component === "api" ? 3001 : 3000;
  const setting = component === "api" ? `DATABASE_URL=${configuration}` : `CRM_API_INTERNAL_URL=${configuration}`;
  docker(["run", "-d", "--pull", "never", "--name", name, "--publish", `127.0.0.1::${String(containerPort)}`,
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--env", setting, image]);
  // Track the actual external runtime until teardown, just as the compiled
  // process fixture does. A detached container alone is not a Node event-loop handle.
  const monitor = spawn("docker", ["wait", name], { windowsHide: true, stdio: "pipe" });
  const stopped = new Promise<void>((done, reject) => { monitor.once("error", reject); monitor.once("exit", () => done()); });
  t.after(async (): Promise<void> => { docker(["stop", "--time", "20", name]); await stopped; });
  const port = docker(["port", name, String(containerPort)]).split(":").at(-1);
  assert.match(port ?? "", /^\d+$/u);
  const origin = `http://127.0.0.1:${String(port)}`;
  for (let n = 0; n < 60; n++) {
    try { if ((await fetch(`${origin}/${component === "api" ? "health/ready" : "api/health"}`, { signal: AbortSignal.timeout(500) })).ok) {
      t.diagnostic(`${component} runtime ${image}; container ${name}; ready on loopback`);
      return origin;
    } } catch { /* bounded startup for this newly-created synthetic fixture */ }
    await new Promise<void>((done) => setTimeout(done, 250));
  }
  throw new Error(`synthetic_${component}_image_not_ready`);
}

export async function webImageProof(t: TestContext, api: string, token: string, campus: string, connector: string): Promise<void> {
  if (!process.env.CRMY171_WEB_IMAGE) return;
  const upstream = new URL(api); assert.equal(upstream.hostname, "127.0.0.1"); upstream.hostname = "host.docker.internal";
  const origin = await imageRuntime(t, "web", upstream.origin);
  const page = await fetch(`${origin}/admin/scheduled-sheets`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Sheets/u);
  const styles = [...html.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/gu)].map((match) => match[1]);
  assert.ok(styles.length > 0, "built Web must serve its generated styles");
  for (const path of styles) { assert.ok(path); assert.equal((await fetch(new URL(path.replaceAll("&amp;", "&"), origin))).status, 200); }
  const headers = { cookie: `crm_session=${token}` };
  const list = await fetch(`${origin}/api/crm/scheduled-sheets?campus=${campus}`, { headers });
  assert.equal(list.status, 200);
  const history = await fetch(`${origin}/api/crm/scheduled-sheets/${connector}/runs`, { headers });
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(await history.json()));
  assert.equal((await fetch(`${origin}/api/crm/scheduled-sheets?campus=${campus}`)).status, 401);
  t.diagnostic("Final Web image: built page/CSS, real authenticated JSON proxy to final API image, persisted configuration/history and anonymous refusal verified.");
}
