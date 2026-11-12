import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
// @ts-expect-error - plain ESM server modules
import { createKeyStore } from "../../server/apikeys.mjs";
// @ts-expect-error - plain ESM server modules
import { encryptWith, decryptWith } from "../../server/crypto.mjs";

const make = () => {
  const key = randomBytes(32);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "lbx-keys-")), "apikeys.enc");
  return { file, store: createKeyStore({ file, encrypt: (o: unknown) => encryptWith(key, o), decrypt: (b: Buffer) => decryptWith(key, b) }) };
};

describe("personal AI API keys", () => {
  it("lets one user have several keys", async () => {
    const { store } = make();
    await store.create("alice", "Claude"); await store.create("alice", "Zapier");
    expect((await store.list("alice")).map((k: { name: string }) => k.name)).toEqual(["Claude", "Zapier"]);
  });
  it("only shows and deletes keys of the owning account", async () => {
    const { store } = make();
    const a = await store.create("alice", "Claude");
    expect(await store.list("bob")).toEqual([]);
    expect(await store.remove("bob", a.id)).toBe(false);
    expect(await store.list("alice")).toHaveLength(1);
    expect(await store.remove("alice", a.id)).toBe(true);
  });
  it("returns the plaintext once and never stores it", async () => {
    const { store, file } = make();
    const a = await store.create("alice", "Claude");
    expect(a.key).toMatch(/^lbx_/);
    expect(JSON.stringify(await store.list("alice"))).not.toContain(a.key);
    expect(readFileSync(file).toString("latin1")).not.toContain(a.key);
    expect(await store.verify(a.key)).toBe("alice");
    expect(await store.verify("lbx_wrong")).toBeNull();
  });
  it("requires a name", async () => {
    await expect(make().store.create("alice", "  ")).rejects.toThrow("name_required");
  });
});
