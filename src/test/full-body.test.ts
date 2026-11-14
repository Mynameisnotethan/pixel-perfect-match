// @ts-nocheck
import { describe, it, expect, vi, afterEach } from "vitest";
import { gmailText, htmlToText, imapTextPart } from "../../connectors/mail-text.mjs";
import { mail } from "../../connectors/mail.mjs";
import { inboxToMessages } from "../../connectors/feed-core.mjs";

const long = "Paragraph of a long email. ".repeat(200) + "FINAL LINE";
const b64 = s => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("received emails show their whole text", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("Gmail uses the full text part, not the short snippet", () => {
    const payload = { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64(long) } }, { mimeType: "text/html", body: { data: b64("<p>x</p>") } }] };
    expect(gmailText(payload)).toBe(long);
  });
  it("HTML-only emails become readable text", () => {
    expect(htmlToText("<style>p{}</style><p>Hello&nbsp;there</p><p>Line 2 &amp; more</p>")).toBe("Hello there\nLine 2 & more");
  });
  it("Outlook asks for the full body as text and keeps all of it", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ value: [{ id: "1", from: { emailAddress: { address: "a@b.com" } }, subject: "s", receivedDateTime: "2026-11-14T00:00:00Z", bodyPreview: long.slice(0, 255), body: { contentType: "text", content: long }, isRead: false, hasAttachments: false }] }), { status: 200 }); });
    const [m] = await mail.microsoft.inbox("tok");
    expect(m.body).toBe(long);
    expect(calls[0].url).toContain("body");
    expect(calls[0].init.headers.Prefer).toBe('outlook.body-content-type="text"');
    expect(inboxToMessages({ id: "microsoft:me@o.com" }, [m])[0].body).toBe(long);
  });
  it("IMAP picks the plain-text part over HTML and skips attachments", () => {
    const tree = { type: "multipart/mixed", childNodes: [{ type: "multipart/alternative", childNodes: [{ part: "1.1", type: "text/plain" }, { part: "1.2", type: "text/html" }] }, { part: "2", type: "text/plain", disposition: "attachment" }] };
    expect(imapTextPart(tree)).toEqual({ part: "1.1", html: false });
  });
});
describe("received emails keep sender name and recipients", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("Outlook keeps sender name, To and Cc", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ value: [{ id: "1", from: { emailAddress: { name: "Ann Lee", address: "ann@x.com" } }, toRecipients: [{ emailAddress: { address: "me@o.com" } }], ccRecipients: [{ emailAddress: { name: "Bo", address: "bo@x.com" } }], subject: "s", receivedDateTime: "2026-11-14T00:00:00Z", body: { contentType: "text", content: "hi" }, hasAttachments: false }] }), { status: 200 }));
    const [m] = inboxToMessages({ id: "microsoft:me@o.com" }, await mail.microsoft.inbox("tok"));
    expect([m.sender, m.email, m.to, m.cc]).toEqual(["Ann Lee", "ann@x.com", "me@o.com", "Bo <bo@x.com>"]);
  });
});
