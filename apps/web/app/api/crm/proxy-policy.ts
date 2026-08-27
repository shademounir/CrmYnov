export const MAX_BODY_BYTES = 1_048_576;

export function apiOrigin(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = environment.CRM_API_INTERNAL_URL ?? (environment.NODE_ENV === "development" ? "http://127.0.0.1:3001" : environment.NODE_ENV === "production" ? "http://api:3001" : "");
  if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/iu.test(value)) throw new Error("crm_api_internal_url_invalid");
  return value;
}

export function safePath(parts: string[]): string {
  if (parts.length === 0 || parts.some((part) => !/^[a-zA-Z0-9._~-]+$/u.test(part) || part === "." || part === "..")) {
    throw new Error("crm_api_path_invalid");
  }
  return parts.map(encodeURIComponent).join("/");
}
