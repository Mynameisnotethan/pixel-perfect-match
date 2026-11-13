import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript module
import { parseAccountView } from "../cypht/mailbox-view.js";

describe("mailbox sidebar navigation", () => {
  it("keeps provider mailbox IDs intact when they contain colons", () => {
    const accounts = [{ id: "google:user@example.com" }, { id: "imap:other@example.com" }];
    expect(parseAccountView("account:google:user@example.com:inbox", accounts)).toEqual({ id: "google:user@example.com", folder: "inbox" });
    expect(parseAccountView("account:imap:other@example.com:sent", accounts)).toEqual({ id: "imap:other@example.com", folder: "sent" });
  });
});
