import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional shared password in front of the whole app (docs/DECISIONS.md D-57).
 * AGENTS.md keeps user accounts out of scope, but a deployment shared inside a
 * company still must not be open to anyone who can reach the port: uploaded
 * files, conversations and paid model keys sit behind it. Set
 * APP_ACCESS_PASSWORD (and optionally APP_ACCESS_USER) to require HTTP Basic
 * authentication on every page and API route; leave it unset for local
 * development. Basic credentials travel with every request, so serve the app
 * over HTTPS whenever this is on.
 *
 * Next.js 16 names this file `proxy.ts` (formerly middleware) and runs it on the
 * Node.js runtime, so node:crypto is available.
 */

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant time comparison; hashing first makes the lengths equal. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Business Operations Assistant", charset="UTF-8"' },
  });
}

export function proxy(request: NextRequest) {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return unauthorized();
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return unauthorized();
  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);

  const expectedUser = process.env.APP_ACCESS_USER;
  const userOk = expectedUser ? safeEqual(user, expectedUser) : true;
  const passOk = safeEqual(pass, password);
  return userOk && passOk ? NextResponse.next() : unauthorized();
}

export const config = {
  // Everything except Next's own static build assets, which hold no data.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
