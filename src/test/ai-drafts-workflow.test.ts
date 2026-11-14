// @ts-nocheck
import { describe, it, expect, vi } from "vitest";
import { createDraftService, parseSendAt } from "../../connectors/ai-drafts.mjs";
import { handleMcpMessage } from "../../connectors/ai-mcp.mjs";

const BOX = { id: "microsoft:ethenry1982@outlook.com", email: "ethenry1982@outlook.com", provider: "microsoft", caps: { drafts: true, send: true } };
const REQUEST = { mailbox: BOX.id, to: ["ethenry1982@outlook.com"], subject: "Lockbox test email", body: "This is a test email from Lockbox." };
const ALL = { read: true, drafts: true, send: true };

function setup({ failCreate = null } = {}) {
  let db = {};
  const p = { sent: [], created: 0, failCreate };
  const api = {
    createDraft: async () => { if (p.failCreate) { const e = p.failCreate; p.failCreate = null; throw e; } return { providerDraftId: "AAMk" + ++p.created }; },
    updateDraft: async () => {}, deleteDraft: async () => {}, draftExists: async () => true,
    sendDraft: async pid => { p.sent.push(pid); return { messageId: null }; },
  };
  const svc = createDraftService({ read: async () => structuredClone(db), write: async d => { db = structuredClone(d); }, feedFor: async () => [], withMailbox: async (_o, _id, fn) => fn(api, BOX) });
  return { svc, p, who: { user: "owner", perms: ALL } };
}

describe("AI draft workflow", () => {
  it("the self-addressed Outlook draft is saved in Outlook and listed with its provider id", async () => {
    const { svc, who } = setup();
    const d = await svc.create(who, REQUEST);
    expect(d).toMatchObject({ version: 1, status: "draft", approved_for_sending: false, storage_status: "saved", saved_in: "Lockbox and Outlook Drafts", provider_draft_id: "AAMk1" });
    expect((await svc.list(who, {})).drafts.map(x => x.draft_id)).toEqual([d.draft_id]);
    expect((await svc.get(who, { draft_id: d.draft_id })).provider_draft_id).toBe("AAMk1");
    expect((await svc.ownerList("owner"))[0]).toMatchObject({ id: d.draft_id, storage_status: "saved" });
  });

  it("a provider refusal keeps the draft in Lockbox, explains it, and update_draft retries", async () => {
    const { svc, who } = setup({ failCreate: Object.assign(new Error("x"), { providerStatus: 403, providerCode: "ErrorAccessDenied" }) });
    const d = await svc.create(who, REQUEST);
    expect(d).toMatchObject({ storage_status: "provider_failed", saved_in: "Lockbox only", provider_draft_id: null });
    expect(d.provider_error).toMatch(/Outlook refused access \(ErrorAccessDenied\)/);
    await expect(svc.send(who, { draft_id: d.draft_id })).rejects.toMatchObject({ code: "provider_not_saved" });
    expect((await svc.update(who, { draft_id: d.draft_id })).storage_status).toBe("saved");
  });

  it("drafts are hidden from keys without draft permission for that mailbox", async () => {
    const { svc, who } = setup();
    const d = await svc.create(who, REQUEST);
    const other = { user: "owner", perms: { read: true, drafts: true, send: false, mailboxes: { "google:x@y.com": { read: true, drafts: true } } } };
    expect((await svc.list(other, {})).drafts).toEqual([]);
    await expect(svc.get(other, { draft_id: d.draft_id })).rejects.toMatchObject({ status: 404 });
  });

  it("request_send_approval never sends, even when already approved", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, REQUEST);
    const r = await svc.requestApproval(who, { draft_id: d.draft_id }, { approvalUrl: id => `https://lb/api/ai/approve/${id}` });
    expect(r.approval_url).toBe(`https://lb/api/ai/approve/${d.draft_id}`);
    const view = await svc.ownerView("owner", d.draft_id);
    await svc.approve("owner", d.draft_id, view.hash);
    expect((await svc.requestApproval(who, { draft_id: d.draft_id })).approved_for_sending).toBe(true);
    expect(p.sent).toEqual([]);
  });

  it("editing invalidates approval and a send goes out once", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, REQUEST);
    await svc.approve("owner", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash);
    await svc.update(who, { draft_id: d.draft_id, body: "changed" });
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("approval_required");
    await svc.approve("owner", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash);
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("sent");
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("sent");
    expect(p.sent).toEqual(["AAMk1"]);
  });

  it("scheduling binds approval to the send time and the runner sends once at that time", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, REQUEST);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const s = await svc.schedule(who, { draft_id: d.draft_id, send_at: at });
    expect(s).toMatchObject({ version: 2, schedule_status: "awaiting_approval", send_at: at });
    expect(s.approval_url).toContain(d.draft_id);
    expect((await svc.send(who, { draft_id: d.draft_id })).status).toBe("scheduled");
    await svc.approve("owner", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash);
    expect(await svc.runDue(Date.now())).toEqual([]);
    expect(p.sent).toEqual([]);
    const later = Date.parse(at) + 1000;
    await Promise.all([svc.runDue(later), svc.runDue(later)]);
    await svc.runDue(later);
    expect(p.sent).toEqual(["AAMk1"]);
    expect((await svc.get(who, { draft_id: d.draft_id })).schedule_status).toBe("sent");
  });

  it("rescheduling or cancelling clears the approval", async () => {
    const { svc, p, who } = setup();
    const d = await svc.create(who, REQUEST);
    await svc.schedule(who, { draft_id: d.draft_id, send_at: new Date(Date.now() + 3600_000).toISOString() });
    await svc.approve("owner", d.draft_id, (await svc.ownerView("owner", d.draft_id)).hash);
    const moved = await svc.schedule(who, { draft_id: d.draft_id, send_at: new Date(Date.now() + 7200_000).toISOString() });
    expect(moved.approved_for_sending).toBe(false);
    const c = await svc.cancelSchedule(who, { draft_id: d.draft_id });
    expect(c).toMatchObject({ send_at: null, approved_for_sending: false });
    await svc.runDue(Date.now() + 10 * 3600_000);
    expect(p.sent).toEqual([]);
  });

  it("send times must name a time zone and be in the future", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(parseSendAt("2026-11-20T09:00:00-05:00", now)).toBe("2026-11-20T14:00:00.000Z");
    expect(() => parseSendAt("2026-11-20T09:00:00", now)).toThrow(/time zone/);
    expect(() => parseSendAt("2026-11-14T12:00:30Z", now)).toThrow(/future/);
  });

  it("MCP errors are sanitized, coded and carry a request id", async () => {
    const { svc } = setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_draft", arguments: { ...REQUEST, to: ["not-an-address"] } } }, { user: "owner", feedFor: async () => [], perms: ALL, drafts: svc });
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.error).toMatchObject({ code: "validation_error" });
    expect(r.result.structuredContent.error.request_id).toMatch(/^req_[0-9a-f]{12}$/);
    expect(r.result.content[0].text).not.toMatch(/invalid_message/);
    expect(String(err.mock.calls[0][0])).not.toMatch(/Lockbox test email|not-an-address/);
    err.mockRestore();
  });
});
