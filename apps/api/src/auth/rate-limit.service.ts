import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

@Injectable()
export class RateLimitService {
  private readonly attempts = new Map<string, number[]>();

  assertAllowed(key: string, now = Date.now(), limit = 5, windowMs = 60_000): void {
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
    if (recent.length >= limit) throw new HttpException({ code: "rate_limit_exceeded" }, HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.attempts.set(key, recent);
  }
}
