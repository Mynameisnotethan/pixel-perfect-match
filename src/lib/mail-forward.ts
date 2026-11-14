// Self-hosted safety net: when the web container receives an /api/* request (because an older
// Hostinger/Traefik config only sent some /api paths to the mail service), pass it straight to the
// mail service instead of answering 404. Enabled only when LOCKBOX_MAIL_UPSTREAM is set (Docker web
// image); Lovable hosting never sets it, so nothing is forwarded there.
const HOP_BY_HOP = ["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "content-length"];

export function mailUpstream(): string | null {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const value = env?.['LOCKBOX_MAIL_UPSTREAM']?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export function shouldForwardToMail(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/oauth/") ||
    pathname.startsWith("/.well-known/oauth-") || pathname === "/.well-known/openid-configuration";
}

export async function forwardToMail(
  request: Request,
  upstream: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  headers.set("x-forwarded-host", request.headers.get("x-forwarded-host") || url.host);
  if (!headers.get("x-forwarded-proto")) headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  const hasBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
  let res: Response;
  try {
    res = await fetchImpl(upstream + url.pathname + url.search, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
      redirect: "manual",
    });
  } catch {
    return new Response(JSON.stringify({ error: "mail_service_unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const out = new Headers(res.headers);
  // fetch already decoded the body, so these would describe the wrong bytes.
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
