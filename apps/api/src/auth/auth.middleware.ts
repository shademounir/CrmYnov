import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./auth.types.js";
import { SessionService } from "./session.service.js";

export function authenticationMiddleware(sessions: SessionService) {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction): void => {
    const header = request.header("authorization");
    if (header?.startsWith("Bearer ")) {
      const principal = sessions.authenticate(header.slice(7));
      if (principal) request.principal = principal;
    }
    next();
  };
}
