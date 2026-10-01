import { health } from "@crm/shared";

export function GET(): Response {
  return Response.json(health("frontend"), { status: 200 });
}
