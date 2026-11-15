// @ts-nocheck
import { describe, it, expect } from "vitest";
import { normalizePerms, canAutoSend } from "../../connectors/ai-perms.mjs";
import { createDraftService } from "../../connectors/ai-drafts.mjs";

const BOX = "microsoft:me@o.com";
function service(sent = [], permsForKey = async () => trusted.perms) {
  let db = {};
  return createDraftService({ permsForKey, read: async () => structuredClone(db), write: async x => { db = structuredClone(x); }, feedFor: async () => [],
    withMailbox: async (_o, id, fn) => fn({ createDraft: async () => ({ providerDraftId: "p1" }), updateDraft: async () => {}, sendDraft: async pid => { sent.push(pid); return { messageId: "m1" }; }, draftExists: async () => true }, { id, email: "me@o.com", provider: "microsoft", caps: { drafts: true, send: true } }) });
}
const send = { [BOX]: { read: true, drafts: true, send: true } };
const trusted = { user: "u", keyId: "k", perms: { mailboxes: send, autoSend: [BOX] } };
const normal = { user: "u", keyId: "k", perms: { mailboxes: send } };

describe("send without per-email approval", () => {
  it("all-mailboxes opt-in covers current and future mailboxes", () => {
    const p = { mailboxes: 'all', read: true, drafts: true, send: true, autoSend: ['*'] };
    expect(canAutoSend(p, BOX)).toBe(true);
    expect(canAutoSend(p, 'google:new@gmail.com')).toBe(true);
    expect(canAutoSend({ ...p, send: false }, BOX)).toBe(false);
    expect(canAutoSend({ ...p, autoSend: [] }, BOX)).toBe(false);
  });
  it("switching to selected mailboxes cannot authorize unlisted mailboxes", () => {
    const p = normalizePerms({ mailboxes: send, autoSend: ['*'] });
    expect(p.autoSend).toEqual([BOX]);
    expect(canAutoSend(p, BOX)).toBe(true);
    expect(canAutoSend(p, 'google:other@gmail.com')).toBe(false);
  });
  it("does not expand existing mailbox-specific consent to all mailboxes", () => {
    const p = { mailboxes: 'all', read: true, drafts: true, send: true, autoSend: [BOX] };
    expect(canAutoSend(p, BOX)).toBe(true);
    expect(canAutoSend(p, 'google:new@gmail.com')).toBe(false);
  });
  it("is off unless the mailbox is listed, and needs Send email", () => {
    expect(normalizePerms({ mailboxes: send }).autoSend).toEqual([]);
    expect(normalizePerms(undefined).autoSend).toEqual([]);
    expect(canAutoSend({ mailboxes: { [BOX]: { read: true, drafts: true } }, autoSend: [BOX] }, BOX)).toBe(false);
    expect(canAutoSend(trusted.perms, BOX)).toBe(true);
  });
  it("send_draft sends the exact version immediately for a trusted mailbox", async () => {
    const sent = []; const svc = service(sent);
    const d = await svc.create(trusted, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    expect(sent).toEqual([]); // creating never sends
    const r = await svc.send(trusted, { draft_id: d.draft_id, version: d.version });
    expect(r.status).toBe("sent"); expect(sent).toEqual(["p1"]);
    expect((await svc.send(trusted, { draft_id: d.draft_id, version: d.version })).status).toBe("sent");
    expect(sent).toHaveLength(1);
  });
  it("refuses a stale or missing version", async () => {
    const svc = service();
    const d = await svc.create(trusted, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    await expect(svc.send(trusted, { draft_id: d.draft_id })).rejects.toThrow(/version/);
    await svc.update(trusted, { draft_id: d.draft_id, body: "changed" });
    await expect(svc.send(trusted, { draft_id: d.draft_id, version: d.version })).rejects.toThrow(/version/);
  });
  it("keeps the approval flow when the setting is off", async () => {
    const sent = []; const svc = service(sent);
    const d = await svc.create(normal, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    expect((await svc.send(normal, { draft_id: d.draft_id, version: d.version })).status).toBe("approval_required");
    expect(sent).toEqual([]);
  });
  it("schedule_send queues the exact version at once and sends it when due", async () => {
    const sent = []; const svc = service(sent);
    const d = await svc.create(trusted, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    const at = new Date(Date.now() + 3600_000).toISOString();
    const r = await svc.schedule(trusted, { draft_id: d.draft_id, version: d.version, send_at: at });
    expect(r.status).toBe("queued"); expect(r.schedule_status).toBe("queued"); expect(r.direct_send).toBe(true); expect(r.approval_url).toBeUndefined();
    await svc.runDue(Date.now()); expect(sent).toEqual([]);
    await svc.runDue(Date.parse(at) + 1000); expect(sent).toEqual(["p1"]);
  });
  it("without the setting, scheduling waits for approval", async () => {
    const sent = []; const svc = service(sent);
    const d = await svc.create(normal, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    const at = new Date(Date.now() + 120_000).toISOString();
    expect((await svc.schedule(normal, { draft_id: d.draft_id, version: d.version, send_at: at })).schedule_status).toBe("awaiting_approval");
    await svc.runDue(Date.parse(at) + 1000); expect(sent).toEqual([]);
  });
});

import { aiDraftsToMessages } from "../cypht/ai-draft-messages.js";
describe("queued sends stay under the owner's control", () => {
  const at = () => new Date(Date.now() + 3600_000).toISOString();
  it("a revoked key cannot release a queued email", async () => {
    const sent = []; let perms = trusted.perms; const svc = service(sent, async () => perms);
    const d = await svc.create(trusted, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    const when = at(); await svc.schedule(trusted, { draft_id: d.draft_id, version: d.version, send_at: when });
    perms = { mailboxes: send }; // owner turned off no-approval sending
    await svc.runDue(Date.parse(when) + 1000);
    expect(sent).toEqual([]);
    expect((await svc.ownerList("u"))[0].schedule_status).toBe("needs_approval");
  });
  it("a deleted key cannot release a queued email", async () => {
    const sent = []; const svc = service(sent, async () => null);
    const d = await svc.create(trusted, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    const when = at(); await svc.schedule(trusted, { draft_id: d.draft_id, version: d.version, send_at: when });
    await svc.runDue(Date.parse(when) + 1000); expect(sent).toEqual([]);
  });
  it("owner cancel stops the send and the email returns to Drafts", async () => {
    const sent = []; const svc = service(sent);
    const d = await svc.create(trusted, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    const when = at(); await svc.schedule(trusted, { draft_id: d.draft_id, version: d.version, send_at: when });
    let msgs = aiDraftsToMessages([], await svc.ownerList("u"));
    expect([msgs[0].folder, msgs[0].aiStatus, msgs[0].to]).toEqual(["scheduled", "queued", "me@o.com"]);
    await svc.ownerCancel("u", d.draft_id);
    await svc.runDue(Date.parse(when) + 1000); expect(sent).toEqual([]);
    msgs = aiDraftsToMessages(msgs, await svc.ownerList("u"));
    expect(msgs[0].folder).toBe("drafts");
  });
  it("an old approval request is not released by turning the setting on", async () => {
    const sent = []; const svc = service(sent);
    const d = await svc.create(normal, { mailbox: BOX, to: "me@o.com", subject: "s", body: "b" });
    const when = at(); await svc.schedule(normal, { draft_id: d.draft_id, version: d.version, send_at: when });
    await svc.runDue(Date.parse(when) + 1000); expect(sent).toEqual([]);
  });
});
