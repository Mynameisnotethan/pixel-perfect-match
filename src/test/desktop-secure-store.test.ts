import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
// @ts-expect-error - plain ESM desktop module
import { createSecureStore } from "../../desktop/secure-store.mjs";

function make() {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "lockbox-secure-")), "private.lbx");
  let vault = "";
  const store = createSecureStore({ file, getKey: async () => vault, setKey: async (value: string) => { vault = value; } });
  return { file, store, vault: () => vault };
}

const message = {
  id: "google:person@example.com:1",
  subject: "Complete email — café \u{1f512}",
  body: "Confidential body\n".repeat(300),
  bodyHtml: "<p>Rich <strong>formatting</strong> stays intact.</p>",
  attachments: [{ name: "statement.pdf", content: "data:application/pdf;base64,AAECAwQFBgcICQ==", size: 10 }],
  hiddenRanges: [[0, 12, "financial"]],
  reviewed: true,
};

describe("encrypted desktop storage", () => {
  it("round-trips every email field without truncation or lossy compression", async () => {
    const { file, store, vault } = make();
    await store.put("messages", [message]);
    expect(await store.get("messages")).toEqual([message]);
    // Reopening decrypts from disk with the same OS-vault key, not from renderer state.
    const reopened = createSecureStore({ file, getKey: async () => vault(), setKey: async () => {} });
    expect(await reopened.get("messages")).toEqual([message]);
    const wrongKey = createSecureStore({ file, getKey: async () => "", setKey: async () => {} });
    await expect(wrongKey.get("messages")).rejects.toThrow();
  });

  it("keeps plaintext and its encryption key out of the data file", async () => {
    const { file, store, vault } = make();
    await store.put("messages", [message]);
    const bytes = readFileSync(file);
    expect(bytes.toString("utf8")).not.toContain("Confidential body");
    expect(bytes.toString("utf8")).not.toContain("statement.pdf");
    expect(bytes.toString("utf8")).not.toContain(vault());
    expect(vault()).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("compresses repetitive email content while preserving it exactly", async () => {
    const { file, store } = make();
    await store.put("messages", [message]);
    expect(statSync(file).size).toBeLessThan(Buffer.byteLength(JSON.stringify([message])) / 2);
  });

  it("serializes updates and removes online-only data", async () => {
    const { store } = make();
    await Promise.all([store.put("a", 1), store.put("b", 2), store.put("a", 3)]);
    expect(await store.get("a")).toBe(3);
    expect(await store.get("b")).toBe(2);
    await store.remove(["a", "b"]);
    expect(await store.get("a", "missing")).toBe("missing");
  });

  it("uses independent random keys for separate installations", async () => {
    const a = make(); const b = make();
    await a.store.put("x", 1); await b.store.put("x", 1);
    expect(a.vault()).not.toBe(b.vault());
    expect(randomBytes(32).length).toBe(32);
  });
});
