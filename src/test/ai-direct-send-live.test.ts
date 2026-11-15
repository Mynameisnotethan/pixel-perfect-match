// @ts-nocheck
// The live ChatGPT path end to end with a mock Outlook: API key or app sign-in -> MCP -> send/schedule.
import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import { createHash } from "node:crypto";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { createAiRoutes, createLimiter } from "../../connectors/ai-feed.mjs";
import { createKeyStore } from "../../connectors/keystore.mjs";
import { createOAuthStore, listConnectedApps, disconnectApp, LOCKBOX_VERSION } from "../../connectors/ai-mcp.mjs";
import { createDraftService } from "../../connectors/ai-drafts.mjs";
import { canAutoSend } from "../../connectors/ai-perms.mjs";
import { KeyEditor } from "../../src/cypht/AiKeys.jsx";
import { checkAccess, scheduleTest } from "../../scripts/check-mcp-tools.mjs";

const BOX = "microsoft:ethenry1982@outlook.com";
const ME = "ethenry1982@outlook.com";
const TRUSTED = { mailboxes: { [BOX]: { read: true, drafts: true, send: true } }, autoSend: [BOX] };
const sha = s => createHash("sha256").update(String(s)).digest("hex");

async function setup() {
  let kdb = {}, ddb = {};
  const sent = [];
  const keys = createKeyStore({ read: async () => structuredClone(kdb), write: async d => { kdb = structuredClone(d); } });
  const oauth = createOAuthStore();
  const outlook = { createDraft: async () => ({ providerDraftId: "p" + (sent.length + 1) }), updateDraft: async () => {}, deleteDraft: async () => {}, sendDraft: async pid => { sent.push(pid); return { messageId: "m-" + pid }; }, draftExists: async () => true };
  const drafts = createDraftService({ read: async () => structuredClone(ddb), write: async d => { ddb = structuredClone(d); }, feedFor: async () => [], permsForKey: (o, id) => keys.permsOf(o, id),
    withMailbox: async (_o, id, fn) => fn(outlook, { id, email: ME, provider: "microsoft", caps: { drafts: true, send: true } }) });
  const routes = createAiRoutes({ verifyKey: x => keys.verify(x), inspectKey: x => keys.inspect(x), drafts, oauth, limit: createLimiter(500), feedFor: async () => [],
    mailboxesFor: async () => [{ id: BOX, email: ME, provider: "microsoft", caps: { drafts: true, send: true } }] });
  const server = http.createServer(async (req, res) => { if (!(await routes(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/ai/v1/mcp`;
  const call = async (token, name, args = {}) => (await (await fetch(base, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  /** What ChatGPT holds after app sign-in: an access token mapped to the key the owner pasted. */
  const appToken = async key => { const t = "chatgpt-access-token-" + Math.random(); await oauth.mutate(d => { d.clients.lbxc_chatgpt = { client_name: "ChatGPT", redirect_uris: [] }; d.tokens[sha(t)] = { kind: "access", key, client_id: "lbxc_chatgpt", exp: Date.now() + 3600e3, at: Date.now() }; }); return t; };
  return { keys, oauth, drafts, sent, call, appToken, base, close: () => server.close() };
}
const log = vi.spyOn(console, "log").mockImplementation(() => {});

describe("direct send over the live MCP path", () => {
  for (const via of ["api_key", "app_sign_in"]) {
    it(`send_draft returns sent once and schedule_send returns queued (${via})`, async () => {
      const s = await setup();
      const k = await s.keys.create("owner", "ChatGPT");
      await s.keys.setPerms("owner", k.id, TRUSTED);
      const token = via === "api_key" ? k.key : await s.appToken(k.key);

      const d = (await s.call(token, "create_draft", { mailbox: BOX, to: [ME], subject: "Lockbox immediate send test", body: "hi" })).structuredContent;
      expect(s.sent).toEqual([]); // creating never sends
      const r = (await s.call(token, "send_draft", { draft_id: d.draft_id, version: d.version })).structuredContent;
      expect(r.status).toBe("sent"); expect(r.approval_url).toBeUndefined();
      expect((await s.call(token, "send_draft", { draft_id: d.draft_id, version: d.version })).structuredContent.status).toBe("sent");
      expect(s.sent).toHaveLength(1);

      const d2 = (await s.call(token, "create_draft", { mailbox: BOX, to: ME, subject: "Lockbox scheduling test", body: "later" })).structuredContent;
      const at = new Date(Date.now() + 3600e3).toISOString();
      const q = (await s.call(token, "schedule_send", { draft_id: d2.draft_id, version: d2.version, send_at: at })).structuredContent;
      expect(q.status).toBe("queued"); expect(q.schedule_status).toBe("queued"); expect(q.send_at).toBe(at); expect(q.approval_url).toBeUndefined();
      // Shown at once in Lockbox → Scheduled (the owner's list), and sent once when due.
      expect((await s.drafts.ownerList("owner")).find(x => x.id === d2.draft_id)).toMatchObject({ send_at: at, schedule_status: "queued" });
      await s.drafts.runDue(Date.parse(at) + 1000); await s.drafts.runDue(Date.parse(at) + 2000);
      expect(s.sent).toHaveLength(2);
      expect(log.mock.calls.some(([line]) => /mcp schedule_send .* status=queued direct_send=true/.test(line) && !line.includes(k.key))).toBe(true);
      s.close();
    });
  }
  it("a key without the setting still needs approval and says why", async () => {
    const s = await setup();
    const k = await s.keys.create("owner", "Other agent");
    await s.keys.setPerms("owner", k.id, { mailboxes: { [BOX]: { read: true, drafts: true, send: true } } });
    const d = (await s.call(k.key, "create_draft", { mailbox: BOX, to: ME, subject: "s", body: "b" })).structuredContent;
    const r = (await s.call(k.key, "send_draft", { draft_id: d.draft_id, version: 1 })).structuredContent;
    expect(r.status).toBe("approval_required"); expect(r.approval_url).toMatch(/approve/);
    expect(r.approval_reason).toBe("direct_send_off_for_key");
    expect(r.approval_reason_text).toContain(`"Other agent" (…${k.last4})`);
    const q = (await s.call(k.key, "schedule_send", { draft_id: d.draft_id, version: 1, send_at: new Date(Date.now() + 3600e3).toISOString() })).structuredContent;
    expect(q.schedule_status).toBe("awaiting_approval"); expect(q.approval_reason).toBe("direct_send_off_for_key");
    expect(s.sent).toEqual([]);
    s.close();
  });
  it("get_access names the key and its per-mailbox rights without any secret", async () => {
    const s = await setup();
    const k = await s.keys.create("owner", "ChatGPT");
    await s.keys.setPerms("owner", k.id, TRUSTED);
    const token = await s.appToken(k.key);
    const r = await s.call(token, "get_access");
    expect(r.structuredContent).toMatchObject({ build: LOCKBOX_VERSION, key: { name: "ChatGPT", last4: k.last4 }, connected_via: "app_sign_in", client: "ChatGPT",
      mailboxes: [{ mailbox: BOX, email: ME, connected: true, see: true, draft: true, send: true, direct_send: true }] });
    const text = JSON.stringify(r);
    expect(text).not.toContain(k.key); expect(text).not.toContain(token);
    s.close();
  });
  it("lists which key an app signed in with, and can disconnect it", async () => {
    const s = await setup();
    const a = await s.keys.create("owner", "Old key"); const b = await s.keys.create("owner", "ChatGPT");
    await s.appToken(a.key);
    const apps = await listConnectedApps(s.oauth, x => s.keys.identify(x), "owner");
    expect(apps).toHaveLength(1); expect(apps[0]).toMatchObject({ keyId: a.id, name: "ChatGPT" });
    expect(await listConnectedApps(s.oauth, x => s.keys.identify(x), "someone-else")).toEqual([]);
    expect(await disconnectApp(s.oauth, x => s.keys.identify(x), "owner", b.id, "lbxc_chatgpt")).toBe(0);
    expect(await disconnectApp(s.oauth, x => s.keys.identify(x), "owner", a.id, "lbxc_chatgpt")).toBe(1);
    expect(await listConnectedApps(s.oauth, x => s.keys.identify(x), "owner")).toEqual([]);
    s.close();
  });
});

describe("live check script", () => {
  it("--access and --schedule-test report queued, then cancel without sending", async () => {
    const s = await setup();
    const k = await s.keys.create("owner", "ChatGPT");
    await s.keys.setPerms("owner", k.id, TRUSTED);
    const a = await checkAccess(s.base, k.key);
    expect(a.access.mailboxes[0]).toMatchObject({ mailbox: BOX, direct_send: true });
    const r = await scheduleTest(s.base, k.key, { mailbox: BOX, to: ME });
    expect(r).toMatchObject({ status: "queued", schedule_status: "queued", direct_send: true, approval_url_returned: false, cancelled: true });
    await s.drafts.runDue(Date.now() + 2 * 3600e3);
    expect(s.sent).toEqual([]);
    s.close();
  });
});

describe("the setting sticks", () => {
  it("mailbox ids match regardless of letter case", () => {
    expect(canAutoSend({ mailboxes: { "Microsoft:EtHenry1982@Outlook.com": { read: true, drafts: true, send: true } }, autoSend: ["microsoft:ethenry1982@outlook.com"] }, BOX)).toBe(true);
  });
  it("saving while the mailbox hasn't loaded keeps its permissions and direct send", async () => {
    const onSave = vi.fn(async () => {});
    render(React.createElement(KeyEditor, { k: { id: "k", name: "ChatGPT", perms: TRUSTED }, mailboxes: [], onSave, onCancel: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ mailboxes: { [BOX]: { send: true } }, autoSend: [BOX] });
  });
});
