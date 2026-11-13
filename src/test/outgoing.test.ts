import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error JavaScript module
import { normalizeOutgoing } from "../../connectors/outgoing.mjs";
// @ts-expect-error JavaScript module
import { mail } from "../../connectors/mail.mjs";
// @ts-expect-error JavaScript module
import { createImapClient } from "../../connectors/imap.mjs";

const message = {
  to: "to@example.com",
  cc: "cc@example.com",
  bcc: "bcc@example.com",
  subject: "Complete message",
  body: "plain text",
  html: "<p><strong>rich text</strong></p>",
  attachments: [{ name: "note.txt", type: "text/plain", content: "data:text/plain;base64,SGVsbG8=" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("complete outgoing messages", () => {
  it("keeps every recipient, rich content, and attachment", () => {
    const result = normalizeOutgoing(message);
    expect(result).toMatchObject({ to: message.to, cc: message.cc, bcc: message.bcc, html: message.html });
    expect(result.attachments[0]).toMatchObject({ name: "note.txt", contentType: "text/plain", size: 5, content: "SGVsbG8=" });
  });

  it("allows Cc/Bcc-only mail but rejects a message with no recipients", () => {
    expect(normalizeOutgoing({ ...message, to: "", cc: "" }).bcc).toBe("bcc@example.com");
    expect(() => normalizeOutgoing({ ...message, to: "", cc: "", bcc: "" })).toThrow("invalid_message");
  });

  it("puts all fields into the Microsoft Graph request", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: "sent" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mail.microsoft.send("token", "me@example.com", message);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.message.toRecipients[0].emailAddress.address).toBe("to@example.com");
    expect(body.message.ccRecipients[0].emailAddress.address).toBe("cc@example.com");
    expect(body.message.bccRecipients[0].emailAddress.address).toBe("bcc@example.com");
    expect(body.message.body).toEqual({ contentType: "HTML", content: message.html });
    expect(body.message.attachments[0]).toMatchObject({ name: "note.txt", contentBytes: "SGVsbG8=" });
  });

  it("builds Gmail MIME with Cc, Bcc, HTML, and the attachment", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: "sent" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mail.google.send("token", "me@example.com", message);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    const mime = Buffer.from(body.raw, "base64url").toString("utf8");
    expect(mime).toContain("Cc: cc@example.com");
    expect(mime).toContain("Bcc: bcc@example.com");
    expect(mime).toContain("text/html");
    expect(mime).toContain("filename=note.txt");
  });

  it("passes the same complete message to SMTP", async () => {
    const sendMail = vi.fn(async (_message: { attachments: Array<{ content: Buffer }> }) => ({}));
    const client = createImapClient({
      ImapFlow: class {},
      nodemailer: { createTransport: () => ({ sendMail }) },
      allowPrivate: true,
    });
    await client.send({ email: "me@example.com", smtp: { host: "smtp.example.com", port: 465, security: "ssl" } }, message);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: message.to, cc: message.cc, bcc: message.bcc, html: message.html }));
    expect(sendMail.mock.calls[0]![0].attachments[0]!.content.toString()).toBe("Hello");
  });
});
