// @ts-expect-error JS module
import { lockStatus, mergeRanges, subtractRange, aiView, mask } from "@/cypht/privacy.js";
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
});
