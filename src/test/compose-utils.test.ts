// @ts-expect-error JavaScript preview utilities have no declarations.
import { addRecipient, draftMessage, duplicateRecipients, isSafeLink, parseRecipients, recipient } from "@/cypht/compose-utils.js";
import { describe, expect, it } from "vitest";

describe("Compose recipient rules", () => {
  it("splits pasted addresses into separate recipients", () => {
    expect(parseRecipients("one@example.test, two@example.test;three@example.test")).toEqual([
      "one@example.test",
      "two@example.test",
      "three@example.test",
    ]);
  });

  it("rejects an invalid address without changing the recipient list", () => {
    const original = [recipient("one@example.test")];
    expect(addRecipient(original, "not-an-address")).toEqual({ list: original, error: "Enter a valid email address." });
  });

  it("finds the same address in To and Bcc", () => {
    expect(duplicateRecipients({ to: [recipient("one@example.test")], cc: [], bcc: [recipient("ONE@example.test")] })).toEqual(["one@example.test"]);
  });
});

describe("Compose message safety", () => {
  it("does not expose Bcc addresses in sent message data", () => {
    const message = draftMessage({ id: "1", recipients: { to: [recipient("to@example.test")], cc: [], bcc: [recipient("private@example.test")] }, bodyHtml: "<p>Hello</p>" }, { email: "me@example.test" }, "sent");
    expect(message.bcc).toBeUndefined();
    expect(message.recipients.bcc).toEqual([]);
  });

  it("rejects a script URL for hyperlinks", () => {
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    expect(isSafeLink("https://example.com")).toBe(true);
  });
});
