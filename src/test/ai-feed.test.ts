import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
// @ts-expect-error - plain ESM modules
import { buildFeed, createAiRoutes, rulesFrom } from "../../connectors/ai-feed.mjs";
// @ts-expect-error - plain ESM modules
import { createKeyStore } from "../../connectors/keystore.mjs";
// @ts-expect-error - plain ESM modules
import { createPrivacyStore } from "../../server/privacy-store.mjs";
// @ts-expect-error - plain ESM modules
import { encryptWith, decryptWith } from "../../server/crypto.mjs";

const box = { id: "google:a@x.com", provider: "google", email: "a@x.com", status: "connected" };
const items = [
  { id: "1", from: "Bank Teller <teller@bank.com>", subject: "Your balance 9999", snippet: "Account 12345 balance", date: "2026-11-10T00:00:00Z" },
  { id: "2", from: "Unopened <u@x.com>", subject: "Secret", snippet: "never shown", date: "2026-11-11T00:00:00Z" },
];
const rules = { "google:a@x.com:1": { reviewed: true, hiddenSubjectRanges: [[13, 17, "financial"]], hiddenSenderRanges: [[0, 11]], hiddenRanges: [[8, 13]] } };
const labels = [{ id: "financial", name: "Financial info", color: "#16a34a" }];
const feed = (privacy: unknown) => buildFeed({ boxes: [box], fetchInbox: async () => items, privacy });

describe("AI agent feed", () => {
  it("never returns hidden subject, sender or body text", async () => {
    const out = await feed({ rules, labels, defaults: {} });
    const text = JSON.stringify(out);
    for (const secret of ["9999", "Bank Teller", "12345"]) expect(text).not.toContain(secret);
    expect(out[0].subject).toBe("Your balance [hidden: Financial info]");
  });
  it("leaves out emails the owner has not reviewed", async () => {
    const out = await feed({ rules, labels, defaults: {} });
    expect(out.map((m: { id: string }) => m.id)).toEqual(["google:a@x.com:1"]);
  });
  it("returns nothing when no rules are saved", async () => {
    expect(await feed(null)).toEqual([]);
  });
  it("applies hide-by-default body setting", async () => {
    const out = await feed({ rules: { "google:a@x.com:1": { reviewed: true } }, defaults: { body: true } });
    expect(out[0].body).not.toContain("12345");
  });
  it("rulesFrom keeps only privacy fields", () => {
    expect(rulesFrom([{ id: "m", body: "x", reviewed: true }])).toEqual({ m: { reviewed: true } });
  });
});

function call(routes: (req: unknown, res: unknown, url: URL) => Promise<boolean>, pathname: string, auth?: string, method = "GET") {
  return new Promise<{ status: number; body: any }>(resolve => {
    const res = { status: 0, writeHead(s: number) { this.status = s; return this; }, end(b: string) { resolve({ status: this.status, body: JSON.parse(b) }); } };
    routes({ method, headers: auth ? { authorization: auth } : {} }, res, new URL(pathname, "http://x"));
  });
}

describe("AI agent API keys", () => {
  const db: Record<string, unknown> = {};
  const keys = createKeyStore({ read: async () => JSON.parse(JSON.stringify(db)), write: async (v: Record<string, unknown>) => { Object.assign(db, v); } });
  const routes = createAiRoutes({ verifyKey: (k: string) => keys.verify(k), feedFor: async (user: string) => [{ id: `${user}-mail` }] });

  it("rejects missing and wrong keys", async () => {
    expect((await call(routes, "/api/ai/v1/messages")).status).toBe(401);
    expect((await call(routes, "/api/ai/v1/messages", "Bearer lbx_wrongwrongwrongwrongwrong")).status).toBe(401);
  });
  it("a key only sees its owner's mail", async () => {
    const a = await keys.create("alice", "A"); await keys.create("bob", "B");
    const r = await call(routes, "/api/ai/v1/messages", `Bearer ${a.key}`);
    expect(r.status).toBe(200);
    expect(r.body.messages).toEqual([{ id: "alice-mail" }]);
  });
  it("is read-only", async () => {
    const a = await keys.create("alice", "A2");
    expect((await call(routes, "/api/ai/v1/messages", `Bearer ${a.key}`, "POST")).status).toBe(405);
  });
  it("a deleted key stops working", async () => {
    const a = await keys.create("alice", "Gone");
    await keys.remove("alice", a.id);
    expect((await call(routes, "/api/ai/v1/messages", `Bearer ${a.key}`)).status).toBe(401);
  });
});

describe("server hide-rule storage", () => {
  it("keeps each user's rules separate", async () => {
    const k = randomBytes(32);
    const store = createPrivacyStore({ file: path.join(mkdtempSync(path.join(tmpdir(), "lbx-p-")), "p.enc"), encrypt: (o: unknown) => encryptWith(k, o), decrypt: (b: Buffer) => decryptWith(k, b) });
    await store.put("alice", { rules: { m: { reviewed: true, body: "leak" } } });
    expect(await store.get("bob")).toBeNull();
    expect((await store.get("alice")).rules).toEqual({ m: { reviewed: true } });
  });
});
