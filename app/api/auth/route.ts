import { NextResponse } from "next/server";
import { security } from "@/config";
import { ADMIN_COOKIE, HttpError, readJson, withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute({ name: "auth", rateLimitMax: 20 }, async ({ request }) => {
  if (!security.authEnabled) {
    return NextResponse.json({ authed: true, authEnabled: false });
  }
  const body = await readJson<{ token?: string }>(request);
  if (!body.token || body.token !== security.adminToken) {
    throw new HttpError(401, "invalid token");
  }
  const res = NextResponse.json({ authed: true, authEnabled: true });
  res.cookies.set(ADMIN_COOKIE, security.adminToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
});

export const DELETE = withRoute({ name: "auth" }, async () => {
  const res = NextResponse.json({ authed: false });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
});
