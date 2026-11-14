// @ts-nocheck
import { describe, it, expect } from "vitest";
import http from "node:http";
import { createHash } from "node:crypto";
import { createAiRoutes, buildFeed, createLimiter } from "../../connectors/ai-feed.mjs";
import { createKeyStore } from "../../connectors/keystore.mjs";
import { createOAuthStore } from "../../connectors/ai-mcp.mjs";

const box = { id: "google:a@x.com", provider: "google", email: "a@x.com", status: "connected" };
const items = [
  { id: "1", from: "Bank <t@bank.com>", subject: "Balance 9999", snippet: "Account 12345", date: "2026-11-10T00:00:00Z" },
  { id: "2", from: "U <u@x.com>", subject: "Unreviewed secret", snippet: "never", date: "2026-11-11T00:00:00Z" },
];
const vis = { subject: false, sender: false, email: false, body: false, attachments: false, sent: { subject: false, to: false, body: false, attachments: false } };
const privacy = { rules: { "google:a@x.com:1": { reviewed: true, hiddenSubjectRanges: [[8, 12]], hiddenRanges: [[8, 13]] } }, defaults: vis };

async function setup({ max = 60 } = {}) {
  let db = {};
  const keys = createKeyStore({ read: async () => db, write: async d => { db = d; } });
  const k = await keys.create("owner", "agent");
  const routes = createAiRoutes({ verifyKey: x => keys.verify(x), oauth: createOAuthStore(), limit: createLimiter(max),
    feedFor: async () => buildFeed({ boxes: [box], fetchInbox: async () => items, privacy }) });
  const server = http.createServer(async (req, res) => { if (!(await routes(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const rpc = (body, token = k.key) => fetch(base + "/api/ai/v1/mcp", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { keys, k, base, rpc, close: () => server.close() };
}

describe("MCP endpoint", () => {
  it("initializes and lists the two read-only tools", async () => {
    const s = await setup();
    const init = await (await s.rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    const list = await (await s.rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map(t => t.name)).toEqual(["list_messages", "get_message"]);
    expect(list.result.tools.every(t => t.annotations.readOnlyHint)).toBe(true);
    expect((await s.rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    s.close();
  });
  it("rejects missing, wrong and deleted keys", async () => {
    const s = await setup();
    const msg = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const none = await s.rpc(msg, null);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect((await s.rpc(msg, "lbx_" + "x".repeat(40))).status).toBe(401);
    await s.keys.remove("owner", s.k.id);
    expect((await s.rpc(msg)).status).toBe(401);
    s.close();
  });
  it("returns only reviewed mail with hidden parts redacted", async () => {
    const s = await setup();
    const r = await (await s.rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_messages", arguments: {} } })).json();
    const text = JSON.stringify(r.result);
    expect(r.result.structuredContent.messages).toHaveLength(1);
    for (const secret of ["9999", "12345", "Unreviewed secret"]) expect(text).not.toContain(secret);
    const g = await (await s.rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_message", arguments: { id: "google:a@x.com:2" } } })).json();
    expect(g.result.isError).toBe(true);
    s.close();
  });
  it("applies the rate limit", async () => {
    const s = await setup({ max: 2 });
    const msg = { jsonrpc: "2.0", id: 1, method: "ping" };
    await s.rpc(msg); await s.rpc(msg);
    expect((await s.rpc(msg)).status).toBe(429);
    s.close();
  });
  it("OAuth needs PKCE and its token stops working when the key is deleted", async () => {
    const s = await setup();
    const reg = await (await fetch(s.base + "/api/ai/v1/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://chatgpt.com/cb"], client_name: "ChatGPT" }) })).json();
    const verifier = "v".repeat(50);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const common = { client_id: reg.client_id, redirect_uri: "https://chatgpt.com/cb", state: "s1" };
    const noPkce = await fetch(s.base + "/api/ai/v1/oauth/authorize?" + new URLSearchParams(common), { redirect: "manual" });
    expect(noPkce.headers.get("location")).toContain("error=invalid_request");
    const form = new URLSearchParams({ ...common, code_challenge: challenge, code_challenge_method: "S256", api_key: s.k.key });
    const auth = await fetch(s.base + "/api/ai/v1/oauth/authorize", { method: "POST", body: form, redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" } });
    const code = new URL(auth.headers.get("location")).searchParams.get("code");
    const bad = await fetch(s.base + "/api/ai/v1/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: common.redirect_uri, code_verifier: "wrong".repeat(10) }) });
    expect(bad.status).toBe(400); // code is single-use too, so get a fresh one
    const auth2 = await fetch(s.base + "/api/ai/v1/oauth/authorize", { method: "POST", body: form, redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" } });
    const code2 = new URL(auth2.headers.get("location")).searchParams.get("code");
    const tok = await (await fetch(s.base + "/api/ai/v1/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: code2, client_id: reg.client_id, redirect_uri: common.redirect_uri, code_verifier: verifier }) })).json();
    const msg = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await s.rpc(msg, tok.access_token)).status).toBe(200);
    await s.keys.remove("owner", s.k.id);
    expect((await s.rpc(msg, tok.access_token)).status).toBe(401);
    s.close();
  });
});
