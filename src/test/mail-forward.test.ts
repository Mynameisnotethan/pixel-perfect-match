import { describe, expect, it, vi } from "vitest";
import { forwardToMail, shouldForwardToMail } from "@/lib/mail-forward";

describe("web container forwards mail-service requests", () => {
  it("forwards every /api path, including privacy and AI keys", () => {
    expect(shouldForwardToMail("/api/privacy")).toBe(true);
    expect(shouldForwardToMail("/api/ai/keys")).toBe(true);
    expect(shouldForwardToMail("/api/ai/v1/messages")).toBe(true);
    expect(shouldForwardToMail("/")).toBe(false);
    expect(shouldForwardToMail("/apistuff")).toBe(false);
  });

  it("passes method, body, cookies and CSRF header through and returns the mail response", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const h = new Headers(init.headers);
      expect(h.get("cookie")).toBe("lockbox_session=abc");
      expect(h.get("x-csrf-token")).toBe("t1");
      expect(h.get("x-forwarded-proto")).toBe("https");
      expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"name":"k"}');
      return new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json" } });
    });
    const req = new Request("https://mail.example.com/api/ai/keys?x=1", {
      method: "POST",
      headers: { cookie: "lockbox_session=abc", "x-csrf-token": "t1" },
      body: '{"name":"k"}',
    });
    const res = await forwardToMail(req, "http://mail:3000", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://mail:3000/api/ai/keys?x=1");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers 502 when the mail service is down", async () => {
    const res = await forwardToMail(new Request("https://x/api/privacy"), "http://mail:3000", (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect(res.status).toBe(502);
  });
});
