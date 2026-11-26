import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_DIR = fileURLToPath(new URL("../../app/api/", import.meta.url));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const PUBLIC_ROUTES: Record<string, string> = {
  "POST /api/auth":
    "the admin login itself; rate limited to 20 a minute, compares in constant time",
  "DELETE /api/auth": "logout only clears the caller's own cookie",
  "GET /api/health": "uptime probe; returns only up/down, the active Region and latency",
  "POST /api/proof":
    "the public least-privilege proof; every statement rolls back, rate limited per IP and overall",
  "GET /api/proof":
    "the visitor run count on /proof; counts only, cached at the edge, rate limited per IP",
};

export const AGENT_ROUTES: Record<string, string> = {
  "POST /api/spend": "an agent's scoped API key, or the admin token",
  "POST /api/reserve": "an agent's scoped API key, or the admin token",
  "POST /api/settle": "an agent's scoped API key, or the admin token",
  "POST /api/release": "an agent's scoped API key, or the admin token",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

export interface RouteHandler {
  key: string;
  file: string;
  wrapped: boolean;
  admin: boolean;
}

export function handlersIn(source: string, file: string): RouteHandler[] {
  const path = "/api/" + relative(API_DIR, file).replace(/\/?route\.ts$/, "");
  const found: RouteHandler[] = [];
  const pattern = new RegExp(
    `export\\s+(?:const\\s+(${METHODS.join("|")})\\s*=\\s*withRoute\\(\\s*\\{([^}]*)\\}|(?:async\\s+)?function\\s+(${METHODS.join("|")})\\b|const\\s+(${METHODS.join("|")})\\b)`,
    "g",
  );
  for (const m of source.matchAll(pattern)) {
    const method = m[1] ?? m[3] ?? m[4];
    found.push({
      key: `${method} ${path}`,
      file,
      wrapped: m[1] !== undefined,
      admin: m[1] !== undefined && /\badmin:\s*true\b/.test(m[2] ?? ""),
    });
  }
  return found;
}

export function ungated(
  handlers: RouteHandler[],
  sources: Map<string, string>,
  publicRoutes: Record<string, string> = PUBLIC_ROUTES,
  agentRoutes: Record<string, string> = AGENT_ROUTES,
): string[] {
  return handlers
    .filter((h) => {
      if (!h.wrapped) return true;
      if (h.admin) return false;
      if (h.key in publicRoutes) return false;
      if (h.key in agentRoutes) {
        const source = sources.get(h.file) ?? "";
        return !(source.includes("resolveApiKey(") && source.includes("isAdmin(request)"));
      }
      return true;
    })
    .map((h) => h.key);
}

const files = routeFiles(API_DIR);
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const handlers = files.flatMap((f) => handlersIn(sources.get(f) ?? "", f));

describe("WA SEC03-BP01, SEC01-BP06: no API route ships without a gate or a written reason", () => {
  it("finds every route handler under app/api", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const file of files) {
      expect(handlersIn(sources.get(file) ?? "", file).length, file).toBeGreaterThan(0);
    }
  });

  it("every handler runs through withRoute and is admin, agent-key or on the public list", () => {
    expect(ungated(handlers, sources)).toEqual([]);
  });

  it("the allowlists name only handlers that exist, so a deleted route leaves no stale exemption", () => {
    const keys = new Set(handlers.map((h) => h.key));
    for (const key of [...Object.keys(PUBLIC_ROUTES), ...Object.keys(AGENT_ROUTES)]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it("catches a route that drops its admin flag or skips withRoute", () => {
    const file = join(API_DIR, "export", "route.ts");
    const open = `export const GET = withRoute({ name: "export" }, async () => x);`;
    const bare = `export async function GET() { return x; }`;
    for (const source of [open, bare]) {
      const found = handlersIn(source, file);
      expect(ungated(found, new Map([[file, source]]))).toEqual(["GET /api/export"]);
    }
  });
});
