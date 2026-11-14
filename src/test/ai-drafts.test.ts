// @ts-nocheck
import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { createAiRoutes, buildFeed, createLimiter } from "../../connectors/ai-feed.mjs";
import { createKeyStore } from "../../connectors/keystore.mjs";
import { createDraftService } from "../../connectors/ai-drafts.mjs";
import { mail } from "../../connectors/mail.mjs";
import { aiCapabilities } from "../../connectors/providers.mjs";
import { refreshScope } from "../../connectors/oauth.mjs";

const GMAIL_SCOPE = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose";
const boxes = {
  "google:me@x.com": { id: "google:me@x.com", provider: "google", email: "me@x.com", status: "connected", scope: GMAIL_SCOPE },
  "microsoft:me@o.com": { id: "microsoft:me@o.com", provider: "microsoft", email: "me@o.com", status: "connected", scope: "Mail.Read Mail.Send Mail.ReadWrite" },
  "google:old@x.com": { id: "google:old@x.com", provider: "google", email: "old@x.com", status: "connected" },
};
const items = [{ id: "m1", from: "Secret Person <boss@corp.com>", subject: "Salary 90000", snippet: "Your salary is 90000", date: "2026-11-10T00:00:00Z" }];
const vis = { subject: false, sender: false, email: false, body: false, attachments: false, sent: { subject: false, to: false, body: false, attachments: false } };
const privacy = { rules: { "google:me@x.com:m1": { reviewed: true, hiddenSubjectRanges: [[7, 12]], hiddenEmailRanges: [[0, 13]], hiddenRanges: [[15, 20]] } }, defaults: vis };

function fakeProvider() {
  const state = { drafts: {}, sent: [], failNext: null, n: 0 };
  const api = {
    replyContext: async id => ({ threadId: "t-" + id, inReplyTo: "<orig@corp.com>", references: "", from: "Secret Person <boss@corp.com>", replyTo: "", to: "me@x.com, colleague@corp.com", cc: "cc@corp.com", subject: "Salary 90000" }),
    createDraft: async (_from, d) => { const id = "pd" + ++state.n; state.drafts[id] = structuredClone(d); return { providerDraftId: id }; },
    updateDraft: async (_from, pid, d) => { state.drafts[pid] = structuredClone(d); },
    deleteDraft: async pid => { delete state.drafts[pid]; },
    sendDraft: async pid => {
      if (state.failNext) { const e = state.failNext; state.failNext = null; if (e.sentAnyway) { state.sent.push(pid); delete state.drafts[pid]; } throw e; }
      state.sent.push(pid); delete state.drafts[pid]; return { messageId: "pm-" + pid };
    },
    draftExists: async pid => !!state.drafts[pid],
  };
  return { state, api };
}

function setup({ confirm = null } = {}) {
  const p = fakeProvider();
  let db = {};
  const owners = { owner: Object.keys(boxes) };
  const feedFor = async () => buildFeed({ boxes: [boxes["google:me@x.com"]], fetchInbox: async () => items, privacy });
  const svc = createDraftService({
    read: async () => db, write: async d => { db = structuredClone(d); }, feedFor, confirm,
    withMailbox: async (owner, id, fn) => {
      if (!owners[owner]?.includes(id)) throw Object.assign(new Error("not_found"), { status: 404 });
      const b = boxes[id]; return fn(p.api, { ...b, caps: aiCapabilities(b.provider, b.scope) });
    },
  });
  return { svc, p, who: { user: "owner", keyId: "k1", perms: { read: true, drafts: true, send: true } } };
}

describe("AI drafts", () => {
  it("creates a new draft in a chosen mailbox and returns a preview", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, { mailbox: "microsoft:me@o.com", to: ["a@b.com"], cc: "c@d.com", bcc: ["e@f.com"], subject: "Hi", body: "Hello" });
    expect(d).toMatchObject({ mailbox: "microsoft:me@o.com", from: "me@o.com", to: "a@b.com", cc: "c@d.com", bcc: "e@f.com", subject: "Hi", body: "Hello", status: "draft", approved_for_sending: false });
    expect(Object.keys(p.state.drafts)).toHaveLength(1);
  });
  it("replies thread to the sender only, never quote or reveal hidden parts", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, { reply_to_message_id: "google:me@x.com:m1", body: "Thanks!" });
    const sent = Object.values(p.state.drafts)[0];
    expect(sent.reply).toMatchObject({ threadId: "t-m1", inReplyTo: "<orig@corp.com>" });
    expect(sent.baseTo).toEqual(["boss@corp.com"]);
    expect(sent.baseCc).toEqual([]);
    expect(sent.subject).toBe("Re: Salary 90000");
    expect(sent.body).toBe("Thanks!");
    const text = JSON.stringify(d);
    for (const secret of ["90000", "boss@corp.com"]) expect(text).not.toContain(secret);
    expect(d.to).toContain("[hidden");
  });
  it("adds the other recipients only for reply-all", async () => {
    const { svc, p, who } = setup();
    await svc.create(who, { reply_to_message_id: "google:me@x.com:m1", reply_all: true, body: "All" });
    expect(Object.values(p.state.drafts)[0].baseCc).toEqual(["colleague@corp.com", "cc@corp.com"]);
  });
  it("refuses replies to unreviewed mail and mailboxes the owner does not own", async () => {
    const { svc, who } = setup();
    await expect(svc.create(who, { reply_to_message_id: "google:me@x.com:nope", body: "x" })).rejects.toThrow(/reviewed/);
    await expect(svc.create({ ...who, user: "intruder" }, { mailbox: "google:me@x.com", to: "a@b.com", body: "x" })).rejects.toThrow();
    const d = await svc.create(who, { mailbox: "google:me@x.com", to: "a@b.com", body: "x" });
    await expect(svc.update({ ...who, user: "intruder" }, { draft_id: d.draft_id, body: "y" })).rejects.toThrow(/not found/i);
    await expect(svc.send({ ...who, user: "intruder" }, { draft_id: d.draft_id })).rejects.toThrow(/not found/i);
  });
  it("asks older connections to allow drafts", async () => {
    const { svc, who } = setup();
    await expect(svc.create(who, { mailbox: "google:old@x.com", to: "a@b.com", body: "x" })).rejects.toThrow(/sign in again/);
  });
  it("needs owner approval of the exact version, and edits cancel it", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, { mailbox: "google:me@x.com", to: "a@b.com", subject: "S", body: "v1" });
    const first = await svc.send(who, { draft_id: d.draft_id, approved: true });
    expect(first.status).toBe("approval_required");
    expect(first.approval_url).toContain(d.draft_id);
    expect(p.state.sent).toEqual([]);
    const view = await svc.ownerView("owner", d.draft_id);
    await svc.approve("owner", d.draft_id, view.hash);
    const edited = await svc.update(who, { draft_id: d.draft_id, body: "v2" });
    expect(edited.version).toBe(2);
    expect(edited.approved_for_sending).toBe(false);
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("approval_required");
    await expect(svc.approve("owner", d.draft_id, view.hash)).rejects.toThrow(/changed/);
    await expect(svc.approve("intruder", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash)).rejects.toThrow(/not found/i);
  });
  it("sends an approved version exactly once, even when called repeatedly or in parallel", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, { mailbox: "google:me@x.com", to: "a@b.com", body: "go" });
    await svc.approve("owner", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash);
    const results = await Promise.all([1, 2, 3].map(() => svc.send(who, { draft_id: d.draft_id })));
    expect(p.state.sent).toHaveLength(1);
    expect(results.filter(r => r.status === "sent")).toHaveLength(1);
    expect(results.every(r => ["sent", "sending"].includes(r.status))).toBe(true);
    expect(results.find(r => r.status === "sent").provider_message_id).toBe("pm-pd1");
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("sent");
    expect(p.state.sent).toHaveLength(1);
    await expect(svc.update(who, { draft_id: d.draft_id, body: "again" })).rejects.toThrow(/already sent/);
  });
  it("marks an unclear provider answer unknown and reconciles before any retry", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, { mailbox: "google:me@x.com", to: "a@b.com", body: "go" });
    await svc.approve("owner", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash);
    p.state.failNext = Object.assign(new Error("socket hang up"), { sentAnyway: true });
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("send_status_unknown");
    const again = await svc.send(who, { draft_id: d.draft_id });
    expect(again.status).toBe("sent");
    expect(p.state.sent).toHaveLength(1);
  });
  it("retries after an unclear answer when the draft is still there", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, { mailbox: "google:me@x.com", to: "a@b.com", body: "go" });
    await svc.approve("owner", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash);
    p.state.failNext = Object.assign(new Error("timeout"), {});
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("send_status_unknown");
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("sent");
    expect(p.state.sent).toHaveLength(1);
  });
  it("uses a trusted native confirmation when available (desktop)", async () => {
    let answer = false;
    const { svc, p, who } = setup({ confirm: async view => { expect(view.to).toBe("a@b.com"); return answer; } });
    const d = await svc.create(who, { mailbox: "google:me@x.com", to: "a@b.com", body: "go" });
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("approval_required");
    answer = true;
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("sent");
    expect(p.state.sent).toHaveLength(1);
  });
});

describe("Key permissions over MCP", () => {
  async function server() {
    let db = {};
    const keys = createKeyStore({ read: async () => db, write: async d => { db = d; } });
    const { svc } = setup();
    const routes = createAiRoutes({ verifyKey: x => keys.verify(x), inspectKey: x => keys.inspect(x), drafts: svc, limit: createLimiter(500),
      feedFor: async () => buildFeed({ boxes: [boxes["google:me@x.com"]], fetchInbox: async () => items, privacy }) });
    const s = http.createServer(async (req, res) => { if (!(await routes(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
    await new Promise(r => s.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${s.address().port}`;
    const call = async (key, name, args = {}) => (await (await fetch(base + "/api/ai/v1/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
    const tools = async key => (await (await fetch(base + "/api/ai/v1/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json()).result.tools.map(t => t.name);
    return { keys, call, tools, close: () => s.close() };
  }
  it("existing keys stay read-only; draft-only keys cannot send", async () => {
    const s = await server();
    const k = await s.keys.create("owner", "agent");
    expect(k.perms).toMatchObject({ read: true, drafts: false, send: false });
    expect(await s.tools(k.key)).toEqual(["list_messages", "get_message"]);
    expect((await s.call(k.key, "list_messages")).structuredContent.messages).toHaveLength(1);
    expect((await s.call(k.key, "create_draft", { mailbox: "google:me@x.com", to: "a@b.com", body: "x" })).isError).toBe(true);
    await s.keys.setPerms("owner", k.id, { read: true, drafts: true, send: false });
    expect(await s.tools(k.key)).toEqual(["list_messages", "get_message", "create_draft", "update_draft"]);
    const made = await s.call(k.key, "create_draft", { mailbox: "google:me@x.com", to: "a@b.com", body: "x" });
    expect(made.isError).toBeFalsy();
    const send = await s.call(k.key, "send_draft", { draft_id: made.structuredContent.draft_id });
    expect(send.isError).toBe(true);
    expect(send.content[0].text).toMatch(/not allowed/);
    await s.keys.setPerms("owner", k.id, { read: true, drafts: true, send: true });
    expect((await s.call(k.key, "send_draft", { draft_id: made.structuredContent.draft_id })).structuredContent.status).toBe("approval_required");
    expect((await s.call(k.key, "send_draft", { draft_id: made.structuredContent.draft_id, approved: true })).isError).toBe(true);
    expect(await s.keys.setPerms("intruder", k.id, { send: true })).toBeNull();
    s.close();
  });
  it("send permission needs drafts", async () => {
    const s = await server();
    const k = await s.keys.create("owner", "agent");
    expect((await s.keys.setPerms("owner", k.id, { send: true })).perms).toMatchObject({ read: true, drafts: false, send: false });
    s.close();
  });
});

describe("Provider draft calls", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = { id: "drf_1", to: "boss@corp.com", cc: "", bcc: "", subject: "Re: Hi", body: "Thanks", reply: { threadId: "T1", inReplyTo: "<orig@corp.com>", references: "<a@corp.com>", graphId: "G1" } };
  it("Gmail drafts thread with In-Reply-To and threadId", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, init = {}) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: "D1" }), { status: 200 }); });
    expect(await mail.google.createDraft("tok", "me@x.com", reply)).toEqual({ providerDraftId: "D1" });
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toMatch(/\/drafts$/);
    expect(body.message.threadId).toBe("T1");
    const raw = Buffer.from(body.message.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    expect(raw).toContain("In-Reply-To: <orig@corp.com>");
    expect(raw).toMatch(/References: <a@corp.com> <orig@corp.com>/);
  });
  it("Outlook replies use createReply and replace the quoted body", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, init = {}) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: "R1" }), { status: 200 }); });
    await mail.microsoft.createDraft("tok", "me@o.com", reply);
    expect(calls[0].url).toMatch(/messages\/G1\/createReply$/);
    expect(calls[1].init.method).toBe("PATCH");
    expect(JSON.parse(calls[1].init.body).body).toEqual({ contentType: "Text", content: "Thanks" });
  });
  it("a missing draft means it was sent", async () => {
    vi.stubGlobal("fetch", async () => new Response("gone", { status: 404 }));
    expect(await mail.google.draftExists("tok", "D1")).toBe(false);
    expect(await mail.microsoft.draftExists("tok", "D1")).toBe(false);
  });
});

describe("Mailbox consent", () => {
  it("knows which connections allow drafts", () => {
    expect(aiCapabilities("google", GMAIL_SCOPE)).toEqual({ drafts: true, send: true });
    expect(aiCapabilities("google", undefined)).toEqual({ drafts: false, send: false });
    expect(aiCapabilities("microsoft", "Mail.Read Mail.Send")).toEqual({ drafts: false, send: false });
    expect(aiCapabilities("microsoft", "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send")).toEqual({ drafts: true, send: true });
  });
  it("refreshing an older connection never asks for new scopes, so reading keeps working", () => {
    expect(refreshScope("microsoft", undefined)).not.toContain("Mail.ReadWrite");
    expect(refreshScope("google", undefined)).not.toContain("gmail.compose");
    expect(refreshScope("microsoft", "Mail.Read User.Read")).toBe("Mail.Read User.Read offline_access");
  });
});
