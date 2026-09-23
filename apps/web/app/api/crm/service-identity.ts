import { GoogleAuth } from "google-auth-library";

type IdentityClient = Awaited<ReturnType<GoogleAuth["getIdTokenClient"]>>;
type IdentityClientFactory = (audience: string) => Promise<IdentityClient>;

export function serviceIdentityEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.CRM_API_USE_IAM === "true";
}

export function createServiceAuthorization(
  getIdTokenClient: IdentityClientFactory = (audience) => new GoogleAuth().getIdTokenClient(audience),
) {
  let cachedAudience: string | undefined;
  let cachedClient: IdentityClient | undefined;

  return async function authorize(
    audience: string,
    environment: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<string | undefined> {
    if (!serviceIdentityEnabled(environment)) return undefined;
    if (cachedAudience !== audience || !cachedClient) {
      cachedClient = await getIdTokenClient(audience);
      cachedAudience = audience;
    }
    const requestHeaders = await cachedClient.getRequestHeaders(audience);
    const value = requestHeaders.get("authorization");
    if (!value?.startsWith("Bearer ")) throw new Error("crm_api_service_identity_unavailable");
    return value;
  };
}

export const serviceAuthorization = createServiceAuthorization();
