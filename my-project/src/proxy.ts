import { NextRequest, NextResponse } from "next/server";

/**
 * CiaNet edge guard (Task 40)
 * The sandbox preview domain (*.space-z.ai) must never serve content:
 * every request on a non-allowed host is permanently redirected (308)
 * to the public site https://cianet.ir/ . Allowed hosts (panel.cianet.ir
 * via the Cloudflare tunnel, plus localhost / IP-literal / agent traffic)
 * pass through untouched.
 */

const REDIRECT_TARGET = "https://cianet.ir/";

const ALLOWED_HOSTS = new Set([
  "panel.cianet.ir", // main panel (via Cloudflare tunnel -> Caddy :81 -> :3000)
  "cianet.ir",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

function normalizeHost(raw: string | null): string {
  if (!raw) return "";
  // x-forwarded-host may be a comma-separated list — first entry wins
  let h = raw.trim().toLowerCase().split(",")[0].trim();
  if (h.startsWith("[")) {
    // [::1]:3000 → ::1
    const end = h.indexOf("]");
    h = end === -1 ? h : h.slice(1, end);
  } else {
    // strip :port
    const colon = h.indexOf(":");
    if (colon !== -1) h = h.slice(0, colon);
  }
  return h;
}

function isIpLiteral(h: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(":");
}

function looksLikePreview(raw: string | null): boolean {
  if (!raw) return false;
  return raw.toLowerCase().includes("space-z.ai");
}

function shouldServe(host: string, forwardedRaw: string | null): boolean {
  if (looksLikePreview(forwardedRaw) || looksLikePreview(host)) return false;
  if (!host) return true;
  if (ALLOWED_HOSTS.has(host)) return true;
  if (isIpLiteral(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const xfh = request.headers.get("x-forwarded-host");
  const host = normalizeHost(xfh ?? request.headers.get("host"));
  if (!shouldServe(host, request.headers.get("forwarded"))) {
    return NextResponse.redirect(REDIRECT_TARGET, 308);
  }
  return NextResponse.next();
}

export const config = {
  // every path (pages, api, files) — the preview host must serve nothing
  matcher: "/:path*",
};
