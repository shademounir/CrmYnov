import assert from "node:assert/strict";
import test from "node:test";
import { createServiceAuthorization, serviceIdentityEnabled } from "../app/api/crm/service-identity.js";

test("service identity stays disabled unless explicitly requested", async () => {
  let contacted = false;
  const authorize = createServiceAuthorization(() => {
    contacted = true;
    return Promise.resolve({ getRequestHeaders: () => Promise.resolve(new Headers()) } as never);
  });

  assert.equal(serviceIdentityEnabled({}), false);
  assert.equal(serviceIdentityEnabled({ CRM_API_USE_IAM: "true" }), true);
  assert.equal(await authorize("https://api.example.test", {}), undefined);
  assert.equal(contacted, false);
});

test("service identity caches a client per audience and returns only a bearer token", async () => {
  const audiences: string[] = [];
  const authorize = createServiceAuthorization((audience) => {
    audiences.push(audience);
    return Promise.resolve({
      getRequestHeaders: () => Promise.resolve(new Headers({ authorization: `Bearer token-for-${audience}` })),
    } as never);
  });
  const environment = { CRM_API_USE_IAM: "true" };

  assert.equal(await authorize("api-a", environment), "Bearer token-for-api-a");
  assert.equal(await authorize("api-a", environment), "Bearer token-for-api-a");
  assert.equal(await authorize("api-b", environment), "Bearer token-for-api-b");
  assert.deepEqual(audiences, ["api-a", "api-b"]);
});

test("service identity rejects a missing or malformed authorization header", async () => {
  const authorize = createServiceAuthorization(() => Promise.resolve({
    getRequestHeaders: () => Promise.resolve(new Headers({ authorization: "Basic invalid" })),
  } as never));

  await assert.rejects(
    authorize("https://api.example.test", { CRM_API_USE_IAM: "true" }),
    /crm_api_service_identity_unavailable/u,
  );
});
