import { GoogleAuth } from "google-auth-library";

let cachedAudience: string | undefined;
let cachedClient: Awaited<ReturnType<GoogleAuth["getIdTokenClient"]>> | undefined;

export function serviceIdentityEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.CRM_API_USE_IAM === "true";
}

export async function serviceAuthorization(
  audience: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | undefined> {
  if (!serviceIdentityEnabled(environment)) return undefined;
  if (cachedAudience !== audience || !cachedClient) {
    cachedClient = await new GoogleAuth().getIdTokenClient(audience);
    cachedAudience = audience;
  }
  const requestHeaders = await cachedClient.getRequestHeaders(audience);
  const value = requestHeaders.get("authorization");
  if (!value?.startsWith("Bearer ")) throw new Error("crm_api_service_identity_unavailable");
  return value;
}
