import { describe, it, expect } from "vitest";
// @ts-expect-error JS module
import { normalizeImap, friendlyImapError } from "../../connectors/imap.mjs";
// @ts-expect-error JS module
import { presetForEmail, IMAP_PRESETS, upsertMailbox } from "../cypht/mailbox-demo.js";

const base = { email: "me@yahoo.com", password: "p", imap: { host: "imap.mail.yahoo.com", port: 993, security: "ssl" }, smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "ssl" } };

describe("IMAP/SMTP mailboxes", () => {
  it("picks server settings from the email domain", () => {
    expect(presetForEmail("a@icloud.com")).toBe("icloud");
    expect(IMAP_PRESETS.icloud.smtp).toEqual({ host: "smtp.mail.me.com", port: 587, security: "starttls" });
    expect(presetForEmail("a@mycompany.com")).toBe("custom");
  });
  it("refuses unencrypted connections", () => {
    expect(() => normalizeImap({ ...base, imap: { ...base.imap, security: "none" } })).toThrow("encryption_required");
  });
  it("refuses private network servers on the hosted server", () => {
    expect(() => normalizeImap({ ...base, imap: { host: "127.0.0.1", port: 993, security: "ssl" } })).toThrow("private_host_not_allowed");
    expect(() => normalizeImap({ ...base, smtp: { host: "192.168.1.5", port: 465, security: "ssl" } })).toThrow("private_host_not_allowed");
    expect(normalizeImap({ ...base, imap: { host: "127.0.0.1", port: 1143, security: "starttls" } }, { allowPrivate: true }).imap.port).toBe(1143);
  });
  it("uses the email as username when none is given", () => expect(normalizeImap(base).username).toBe("me@yahoo.com"));
  it("explains wrong passwords and app-password requirements plainly", () => {
    expect(friendlyImapError({ responseText: "AUTHENTICATIONFAILED Invalid credentials" })).toBe("wrong_password");
    expect(friendlyImapError({ responseText: "Application-specific password required" })).toBe("app_password_needed");
  });
  it("Servers and Add mailbox share one list: reconnecting an IMAP mailbox updates it in place", () => {
    let list = upsertMailbox([], { id: "imap:me@yahoo.com", provider: "imap", email: "me@yahoo.com", status: "reconnect" });
    list = upsertMailbox(list, { id: "imap:me@yahoo.com", provider: "imap", email: "Me@Yahoo.com", status: "connected" });
    expect(list).toHaveLength(1); expect(list[0].id).toBe("imap:me@yahoo.com"); expect(list[0].status).toBe("connected");
  });
});
