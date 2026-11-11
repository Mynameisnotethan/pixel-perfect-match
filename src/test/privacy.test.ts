// @ts-expect-error JS module
import { lockStatus, mergeRanges, subtractRange, aiView, mask, togglePrivacyField, hideEntireMessage } from "@/cypht/privacy.js";
import { describe, expect, it } from "vitest";
const base = { id: "1", body: "hello world", attachments: [{ name: "a.txt" }], folder: "inbox" };
describe("privacy lock", () => {
  it("unopened is grey and invisible to AI", () => { expect(lockStatus(base)).toBe("grey"); expect(aiView(base)).toBeNull(); });
  it("opened with nothing hidden is green", () => expect(lockStatus({ ...base, reviewed: true })).toBe("green"));
  it("partly hidden is yellow", () => expect(lockStatus({ ...base, reviewed: true, hiddenRanges: [[0, 5]] })).toBe("yellow"));
  it("fully hidden is red", () => expect(lockStatus({ ...base, reviewed: true, hiddenRanges: [[0, 11]], hiddenAttachments: [0] })).toBe("red"));
  it("masks spaces too", () => expect(mask("a b")).toBe("***"));
  it("merges and subtracts ranges", () => { expect(mergeRanges([[0, 3], [2, 6]])).toEqual([[0, 6]]); expect(subtractRange([[0, 6]], [2, 4])).toEqual([[0, 2], [4, 6]]); });
  it("AI view strips hidden parts", () => { const v = aiView({ ...base, reviewed: true, hiddenRanges: [[0, 5]], hiddenAttachments: [0] }); expect(v.body).toBe("[hidden] world"); expect(v.attachments[0].name).toBe("[hidden]"); });
  it("partly hidden subject or sender details make the message yellow", () => {
    expect(lockStatus({ ...base, reviewed: true, hiddenSubjectRanges: [[0, 3]] })).toBe("yellow");
    expect(lockStatus({ ...base, reviewed: true, hiddenSenderRanges: [[0, 3]] })).toBe("yellow");
    expect(lockStatus({ ...base, reviewed: true, hiddenEmailRanges: [[0, 3]] })).toBe("yellow");
  });
  it("AI view redacts only the selected subject, sender name, and email characters", () => {
    const v = aiView({ ...base, reviewed: true, sender: "Jane Doe", email: "jane@example.test", subject: "Private project", hiddenSenderRanges: [[0, 4]], hiddenEmailRanges: [[0, 4]], hiddenSubjectRanges: [[0, 7]] });
    expect(v.from).toBe("[hidden] Doe");
    expect(v.email).toBe("[hidden]@example.test");
    expect(v.subject).toBe("[hidden] project");
    expect(v.body).toBe("hello world");
  });
  it("red requires every supported text field and attachment to be hidden", () => {
    const message = { ...base, reviewed: true, sender: "J", email: "E", subject: "S", body: "B", hiddenRanges: [[0, 1]], hiddenSubjectRanges: [[0, 1]], hiddenSenderRanges: [[0, 1]], hiddenEmailRanges: [[0, 1]], hiddenAttachments: [0] };
    expect(lockStatus(message)).toBe("red");
    expect(lockStatus({ ...message, hiddenSubjectRanges: [] })).toBe("yellow");
  });
  it("field lock hides the whole field and a second tap reveals it", () => {
    const message = { ...base, subject: "Private project" };
    const hidden = togglePrivacyField(message, "subject");
    expect(hidden.hiddenSubjectRanges).toEqual([[0, 15]]);
    expect(togglePrivacyField({ ...message, ...hidden }, "subject").hiddenSubjectRanges).toEqual([]);
  });
  it("hide all covers every supported field and attachment", () => {
    const message = { ...base, sender: "Jane", email: "jane@example.test", subject: "Secret" };
    const hidden = { ...message, ...hideEntireMessage(message) };
    expect(lockStatus(hidden)).toBe("red");
    expect(aiView(hidden)).toMatchObject({ from: "[hidden]", email: "[hidden]", subject: "[hidden]", body: "[hidden]" });
    expect(aiView(hidden).attachments).toEqual([{ name: "[hidden]", hidden: true }]);
  });
});
// @ts-expect-error JS module
import { aiView as view2, lockStatus as status2, togglePrivacyField as toggle2 } from "@/cypht/privacy.js";
describe("AI defaults and labels", () => {
  const m = { id: "2", folder: "inbox", reviewed: true, sender: "Jane", email: "j@x.test", subject: "Hi", body: "pay 500 now", attachments: [{ name: "a.pdf" }] };
  it("labelled hidden text tells the AI the label only", () => {
    expect(view2({ ...m, hiddenRanges: [[4, 7, "financial"]] }).body).toBe("pay [hidden: Financial info] now");
  });
  it("default body rule hides every received body", () => {
    expect(view2(m, { body: true }).body).toBe("[hidden: Body]");
    expect(status2(m, { body: true })).toBe("yellow");
  });
  it("all defaults on makes the email red", () => {
    expect(status2(m, { subject: true, sender: true, email: true, body: true, attachments: true })).toBe("red");
  });
  it("unlocking a field on one email beats the default", () => {
    const eff = { ...m, hiddenRanges: [[0, 11, "auto-body"]] };
    const patch = toggle2(eff, "body");
    expect(view2({ ...m, ...patch }, { body: true }).body).toBe("pay 500 now");
  });
});
