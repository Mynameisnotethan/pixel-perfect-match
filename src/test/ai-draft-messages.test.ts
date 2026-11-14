// @ts-nocheck
import { describe, it, expect } from "vitest";
import { aiDraftsToMessages } from "../cypht/ai-draft-messages.js";
const d = { id: "x1", version: 1, mailbox: "microsoft:me@o.com", to: "a@b.com", subject: "Hi", body: "Body" };
describe("AI drafts appear as normal drafts", () => {
  it("adds an AI draft to Drafts", () => {
    const [m] = aiDraftsToMessages([], [d]);
    expect([m.folder, m.subject, m.to, m.account]).toEqual(["drafts", "Hi", "a@b.com", "microsoft:me@o.com"]);
  });
  it("does not bring back a draft the owner deleted", () => {
    const [m] = aiDraftsToMessages([], [d]);
    expect(aiDraftsToMessages([{ ...m, folder: "trash" }], [{ ...d, version: 2 }])[0].folder).toBe("trash");
  });
  it("a newer AI version replaces an untouched copy but never the owner's edits", () => {
    const [m] = aiDraftsToMessages([], [d]);
    expect(aiDraftsToMessages([m], [{ ...d, version: 2, subject: "New" }])[0].subject).toBe("New");
    expect(aiDraftsToMessages([{ ...m, aiDraft: { ...m.aiDraft, edited: true } }], [{ ...d, version: 2, subject: "New" }])[0].subject).toBe("Hi");
  });
  it("skips drafts already sent", () => { expect(aiDraftsToMessages([], [{ ...d, sent: true }])).toEqual([]); });
});
