import { describe, it, expect } from "vitest";
// @ts-expect-error JS module
import { parseFrom, inboxToMessages } from "@/cypht/mailbox-live.js";
describe("live mailbox sync", () => {
  it("splits sender name and address", () => expect(parseFrom('"Ana Ruiz" <ana@x.com>')).toEqual({ sender: "Ana Ruiz", email: "ana@x.com" }));
  it("scopes synced messages to the mailbox so re-syncs do not duplicate", () => {
    const [m] = inboxToMessages({ id: "google:a@x.com" }, [{ id: "1", from: "b@y.com", subject: "", date: "2026-01-01", snippet: "hi", read: false }]);
    expect(m.id).toBe("google:a@x.com:1"); expect(m.subject).toBe("(no subject)"); expect(m.folder).toBe("inbox");
  });
});
