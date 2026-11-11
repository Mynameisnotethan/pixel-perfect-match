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
// @ts-expect-error JS module
import { makeLabel, addLabel, updateLabel, removeLabel, restoreDefaultLabels, isDuplicateLabel, presetLabels } from "@/cypht/privacy.js";
describe("label management", () => {
  it("adds a named label with the chosen colour", () => {
    const created = makeLabel("  Invoice data  ", "#ea580c", presetLabels);
    expect(created).toMatchObject({ name: "Invoice data", color: "#ea580c" });
    expect(created!.id).toMatch(/^custom-/);
    expect(addLabel(presetLabels, "Invoice data", "#ea580c")).toHaveLength(presetLabels.length + 1);
  });
  it("refuses blank and duplicate names", () => {
    expect(makeLabel("   ", "#16a34a", presetLabels)).toBeNull();
    expect(makeLabel("financial info", "#16a34a", presetLabels)).toBeNull();
    expect(isDuplicateLabel("Other", presetLabels)).toBe(true);
    expect(addLabel(presetLabels, "Other", "#16a34a")).toEqual(presetLabels);
  });
  it("renames and recolours without touching other labels", () => {
    const next = updateLabel(presetLabels, "financial", { name: "Banking", color: "#0891b2" });
    expect(next.find((l: any) => l.id === "financial")).toEqual({ id: "financial", name: "Banking", color: "#0891b2" });
    expect(next.find((l: any) => l.id === "personal")).toEqual(presetLabels.find((l: any) => l.id === "personal"));
    expect(updateLabel(next, "financial", { name: "   " }).find((l: any) => l.id === "financial")!.name).toBe("Banking");
  });
  it("removes one label and restores the defaults", () => {
    expect(removeLabel(presetLabels, "financial").map((l: any) => l.id)).not.toContain("financial");
    const restored = restoreDefaultLabels();
    expect(restored).toEqual(presetLabels);
    restored[0].name = "Changed";
    expect(presetLabels[0].name).toBe("Financial info");
  });
});

// @ts-expect-error JS module
import { remapRanges as _remap, lockStatus as _ls, aiView as _av, applyDefaults as _ad } from '../cypht/privacy.js';
describe('outgoing email privacy', () => {
  const sent = { id: 's1', folder: 'sent', subject: 'Hi', to: 'a@x.test', sender: 'Me', email: 'me@x.test', body: 'Card 1234', attachments: [] };
  it('sent mail with nothing hidden is green even if not reviewed', () => { expect(_ls(sent, {})).toBe('green'); });
  it('hiding the whole subject, recipients and body is red', () => { expect(_ls({ ...sent, hiddenSubjectRanges: [[0, 2]], hiddenToRanges: [[0, 8]], hiddenRanges: [[0, 9]] }, {})).toBe('red'); });
  it('AI view redacts recipients with a label', () => {
    const v = _av({ ...sent, hiddenToRanges: [[0, 8, 'personal']] }, {}, undefined);
    expect(v.to).toBe('[hidden: Personal info]');
    expect(v.from).toBeUndefined();
  });
  it('sent defaults hide the body of every sent email', () => { expect(_ad(sent, { sent: { body: true } }).hiddenRanges).toEqual([[0, 9, 'auto-body']]); });
  it('received defaults do not apply to sent mail', () => { expect(_ad(sent, { body: true }).hiddenRanges).toBeUndefined(); });
  it('remap shifts ranges after an earlier insert', () => { expect(_remap('Card 1234', 'My Card 1234', [[5, 9]])).toEqual([[8, 12]]); });
  it('remap drops a range whose text was deleted', () => { expect(_remap('Card 1234 ok', 'Card ok', [[5, 9]])).toEqual([]); });
});
