// @ts-nocheck
import { describe, it, expect } from "vitest";
import { normalizePerms, canAutoSend } from "../../connectors/ai-perms.mjs";
import { createDraftService } from "../../connectors/ai-drafts.mjs";

const BOX = "microsoft:me@o.com";
function service(sent = []) {
  let db = {};
  return createDraftService({ read: async () => structuredClone(db), write: async x => { db = structuredClone(x); }, feedFor: async () => [],
    withMailbox: async (_o, id, fn) => fn({ createDraft: async () => ({ providerDraftId: "p1" }), updateDraft: async () => {}, sendDraft: async pid => { sent.push(pid); return { messageId: "m1" }; }, draftExists: async () => true }, { id, email: "me@o.com", provider: "microsoft", caps: { drafts: true, send: true } }) });
}
const send = { [BOX]: { read: true, drafts: true, send: true } };
const trusted = { user: "u", keyId: "k", perms: { mailboxes: send, autoSend: [BOX] } };
const normal = { user: "u", keyId: "k", perms: { mailboxes: send } };

describe("send without per-email approval", () => {
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
    expect(r.schedule_status).toBe("scheduled"); expect(r.approval_url).toBeUndefined();
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
