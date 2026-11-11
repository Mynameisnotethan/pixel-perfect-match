import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error JS module
import { deviceError, pollDeviceCode } from "../../connectors/device.mjs";
// @ts-expect-error JS module
import { applySetup, setupView } from "../../server/setup.mjs";

afterEach(() => vi.unstubAllGlobals());
const reply = (ok: boolean, json: object) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => json })));

describe("Outlook sign-in by code", () => {
  it("keeps waiting while the user has not approved yet", async () => {
    reply(false, { error: "authorization_pending" });
    expect(await pollDeviceCode("cid", "dc")).toEqual({ status: "pending" });
  });
  it("returns tokens once approved", async () => {
    reply(true, { access_token: "a", refresh_token: "r", expires_in: 3600 });
    const r = await pollDeviceCode("cid", "dc");
    expect(r.status).toBe("done"); expect(r.tokens.refreshToken).toBe("r");
  });
  it("explains when an admin must approve Lockbox", () => {
    expect(deviceError({ error: "invalid_grant", error_description: "AADSTS65001: consent" })).toMatch(/^admin_approval_required/);
  });
  it("explains when the organization blocks sign-in by code", () => {
    expect(deviceError({ error: "invalid_grant", error_description: "AADSTS50199 blocked" })).toMatch(/^device_code_blocked/);
  });
});

describe("server Setup wizard", () => {
  it("rejects a non-https public address", () => expect(() => applySetup({}, { publicUrl: "http://x.com" })).toThrow("public_url_must_be_https"));
  it("keeps a saved secret when the field is left blank and never shows it", () => {
    const c = applySetup({ google: { clientId: "a", clientSecret: "s" } }, { google: { clientId: "b", clientSecret: "" } });
    expect(c.google).toEqual({ clientId: "b", clientSecret: "s" });
    const v = setupView({ config: c, env: {}, publicUrl: "https://m.x", microsoftMode: "device", deviceAvailable: true });
    expect(JSON.stringify(v)).not.toContain('"s"');
    expect(v.callbacks.google).toBe("https://m.x/oauth/google/callback");
  });
});
