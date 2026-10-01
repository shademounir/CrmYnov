import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./auth.types.js";
import { SessionService } from "./session.service.js";

export function authenticationMiddleware(sessions: SessionService) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> => {
    const header = request.header("authorization");
    if (header?.startsWith("Bearer ")) {
      try {
        const principal = await sessions.authenticateForApi(header.slice(7));
        if (principal) request.principal = principal;
      } catch {
        response.status(503).json({ code: "authentication_unavailable" });
        return;
      }
    }
    next();
  };
}
