import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const runtime = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));

test("Web runtime uses the pinned non-root Distroless standalone server", () => {
  assert.match(runtime, /FROM gcr\.io\/distroless\/nodejs22-debian13:nonroot@sha256:5ef534d3db0ac0c43bee379af4ae49cfbfc0ef38a46c94c52d87c68f32f34d8a AS runtime/);
  assert.match(dockerfile, /libssl3t64=3\.5\.7-1~deb13u3 openssl-provider-legacy=3\.5\.7-1~deb13u3/);
  assert.match(runtime, /COPY --from=patched-openssl \/libssl3t64\.status \/var\/lib\/dpkg\/status\.d\/libssl3t64/);
  assert.match(runtime, /USER 65532:65532/);
  assert.match(runtime, /ENTRYPOINT \["\/nodejs\/bin\/node"\]/);
  assert.match(runtime, /CMD \["apps\/web\/server\.js"\]/);
  assert.doesNotMatch(runtime, /^RUN /m);
  assert.match(runtime, /ENV NODE_ENV=production/);
  assert.match(runtime, /ENV HOSTNAME=0\.0\.0\.0/);
  assert.match(runtime, /ENV PORT=3000/);
  const copies = runtime.split(/\r?\n/).filter((line) => line.startsWith("COPY --from=build "));
  assert.equal(copies.length, 3);
  for (const line of copies) assert.match(line, /--from=build --chown=65532:65532/);
  assert.match(copies[0] ?? "", /\.next\/standalone \.\/$/);
  assert.match(copies[1] ?? "", /\.next\/static \.\/apps\/web\/\.next\/static$/);
  assert.match(copies[2] ?? "", /\/public \.\/apps\/web\/public$/);
});

test("Web healthchecks execute Node directly with a bounded request", () => {
  const compose = readFileSync(new URL("../../../compose.yaml", import.meta.url), "utf8");
  const web = compose.slice(compose.indexOf("\n  web:"), compose.indexOf("\nnetworks:"));
  for (const definition of [runtime, web]) {
    assert.match(definition, /"\/nodejs\/bin\/node", "-e"/);
    assert.match(definition, /http:\/\/127\.0\.0\.1:3000\/api\/health/);
    assert.match(definition, /AbortSignal\.timeout\(2000\)/);
    assert.match(definition, /process\.exit\(r\.ok\?0:1\)/);
    assert.match(definition, /catch\(\(\)=>process\.exit\(1\)\)/);
  }
  assert.match(web, /read_only: true/);
  assert.match(web, /\/workspace\/apps\/web\/\.next\/cache:size=64m,uid=65532,gid=65532,mode=0700/);
});
