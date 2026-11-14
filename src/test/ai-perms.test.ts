// @ts-nocheck
import { describe, it, expect } from "vitest";
import { normalizePerms, can } from "../../connectors/ai-perms.mjs";
import { createDraftService } from "../../connectors/ai-drafts.mjs";

describe("per-mailbox AI key permissions", () => {
  it("migrates old flags to all mailboxes", () => {
    expect(normalizePerms({ read: true, drafts: true, send: false })).toEqual({ mailboxes: "all", read: true, drafts: true, send: false });
    expect(normalizePerms(undefined)).toEqual({ mailboxes: "all", read: true, drafts: false, send: false });
  });
  it("limits access to listed mailboxes", () => {
    const p = { mailboxes: { "google:a@x.com": { read: true, drafts: true, send: true } } };
    expect(can(p, "google:a@x.com", "send")).toBe(true);
    expect(can(p, "google:b@x.com", "read")).toBe(false);
    expect(normalizePerms(p).send).toBe(true);
  });
  it("send needs drafts", () => {
    expect(can({ mailboxes: { m: { read: true, send: true } } }, "m", "send")).toBe(false);
  });
  it("refuses a draft in a mailbox the key may not use", async () => {
    const svc = createDraftService({ read: async () => ({}), write: async () => {}, feedFor: async () => [],
      withMailbox: async (_o: string, id: string, fn: any) => fn({ createDraft: async () => ({ providerDraftId: "p" }) }, { id, email: "b@x.com", provider: "google", caps: { drafts: true, send: true } }) });
    const who = { user: "u", keyId: "k", perms: { mailboxes: { "google:a@x.com": { read: true, drafts: true } } } };
    await expect(svc.create(who, { mailbox: "google:b@x.com", to: "c@d.com", body: "x" })).rejects.toThrow(/not allowed/);
  });
});
