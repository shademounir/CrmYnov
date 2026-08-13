import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export function correlationMiddleware(request: Request, response: Response, next: NextFunction): void {
  const supplied = request.header("x-correlation-id");
  const correlationId = supplied && /^[a-zA-Z0-9._-]{1,64}$/.test(supplied) ? supplied : randomUUID();
  response.setHeader("x-correlation-id", correlationId);
  next();
}
