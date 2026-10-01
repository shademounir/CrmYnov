import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { correlationMiddleware } from "../../src/correlation.middleware.js";

test("preserves a safe correlation id and replaces an unsafe value", () => {
  for (const [provided, expected] of [["request-123", "request-123"], ["unsafe value", undefined]] as const) {
    let value = "";
    const request = { header: () => provided } as unknown as Request;
    const response = { setHeader: (_name: string, header: string) => { value = header; } } as unknown as Response;
    let continued = false;
    correlationMiddleware(request, response, (() => { continued = true; }) as NextFunction);
    assert.equal(continued, true);
    if (expected) assert.equal(value, expected);
    else assert.match(value, /^[0-9a-f-]{36}$/);
  }
});
