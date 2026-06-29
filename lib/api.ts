import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { limits, security } from "@/config";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validate";
import { isConflict } from "@/core/store";

export const ADMIN_COOKIE = "stub_admin";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RouteContext {
  request: Request;
  requestId: string;
}

interface RouteOptions {
  name: string;
  admin?: boolean;
  rateLimitMax?: number;
}

function bearer(request: Request): string | null {
  const auth = request.headers.get("authorization");
  return auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

export function isAdmin(request: Request): boolean {
  if (!security.authEnabled) return true;
  const provided = bearer(request) ?? cookie(request, ADMIN_COOKIE);
  return provided != null && provided === security.adminToken;
}

export async function adminPageAllowed(): Promise<boolean> {
  if (!security.authEnabled) return true;
  const jar = await cookies();
  return jar.get(ADMIN_COOKIE)?.value === security.adminToken;
}

function respond(body: unknown, status: number, requestId: string): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set("x-request-id", requestId);
  return res;
}

export function withRoute(
  opts: RouteOptions,
  handler: (ctx: RouteContext) => Promise<NextResponse>,
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    const requestId = randomUUID();
    const start = Date.now();

    const max = opts.rateLimitMax ?? limits.rateLimitMax;
    const identity = bearer(request) ?? clientIp(request);
    const rl = rateLimit(`${opts.name}:${identity}`, max, limits.rateLimitWindowMs);
    if (!rl.ok) {
      log.warn("rate_limited", { route: opts.name, requestId });
      const res = respond({ error: "rate limit exceeded" }, 429, requestId);
      res.headers.set("retry-after", String(Math.max(1, Math.ceil((rl.resetAt - start) / 1000))));
      return res;
    }

    if (opts.admin && !isAdmin(request)) {
      log.warn("unauthorized", { route: opts.name, requestId });
      return respond({ error: "unauthorized" }, 401, requestId);
    }

    try {
      const res = await handler({ request, requestId });
      res.headers.set("x-request-id", requestId);
      log.info("request", {
        route: opts.name,
        requestId,
        status: res.status,
        ms: Date.now() - start,
      });
      return res;
    } catch (err) {
      if (err instanceof HttpError || err instanceof ValidationError) {
        const status = err instanceof HttpError ? err.status : 400;
        return respond({ error: err.message }, status, requestId);
      }
      if (isConflict(err)) {
        log.warn("occ_exhausted", { route: opts.name, requestId });
        return respond({ error: "the ledger is busy, please retry" }, 503, requestId);
      }
      log.error("unhandled_error", {
        route: opts.name,
        requestId,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      return respond({ error: "internal error", requestId }, 500, requestId);
    }
  };
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}
