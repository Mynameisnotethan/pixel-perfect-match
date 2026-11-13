import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error - the server is plain ESM JavaScript
import { createAuth } from "../../server/auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CODE_RE = /one-time setup code:[\s\S]*?([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/;
const PASSWORD = "correct horse battery";

/** Lockbox's own deployment variables must not leak into a test run. */
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LOCKBOX_")));

async function startServer(dataDir: string, extra: Record<string, string> = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: { ...cleanEnv(), PORT: String(port), LOCKBOX_DATA_DIR: dataDir, ...extra },
  });
  let out = "";
  child.stdout.on("data", d => { out += String(d); });
  child.stderr.on("data", d => { out += String(d); });
  for (let i = 0; i < 120 && !/mailbox server on/.test(out); i++) await new Promise(r => setTimeout(r, 50));
  if (!/mailbox server on/.test(out)) { child.kill(); throw new Error(`server did not start: ${out}`); }
  const base = `http://127.0.0.1:${port}`;
  const call = (pathname: string, init: RequestInit = {}, cookie = "") => fetch(base + pathname, {
    ...init,
    headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) },
    redirect: "manual",
  });
  return { port, child, log: () => out, call, base };
}
const tokenOf = (res: Response) => (res.headers.getSetCookie?.() || []).map(c => c.match(/lockbox_session=([^;]*)/)?.[1]).find(Boolean) || "";
const csrfOf = (res: Response) => (res.headers.getSetCookie?.() || []).map(c => c.match(/lockbox_csrf=([^;]*)/)?.[1]).find(Boolean) || "";

describe("self-hosted sign-in and first-run setup", () => {
  let dir: string;
  let server: Awaited<ReturnType<typeof startServer>>;
  let code = "";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "lockbox-auth-"));
    server = await startServer(dir);
    code = server.log().match(CODE_RE)?.[1] || "";
  });
  afterAll(async () => {
    server.child.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("issues the setup code in the container log only", async () => {
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const res = await server.call("/api/auth/session");
    expect(await res.json()).toEqual({ status: "needs-setup", csrf: null });
    expect(JSON.stringify(await (await server.call("/api/auth/session")).json())).not.toContain(code);
  });

  it("refuses to create an account without the right setup code", async () => {
    for (const body of [{}, { code: "AAAA-BBBB-CCCC", username: "admin", password: PASSWORD }, { code: "zzzz-zzzz-zzzz", username: "admin", password: PASSWORD }]) {
      const res = await server.call("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("setup_code_incorrect");
    }
    expect(await (await server.call("/api/auth/session")).json()).toMatchObject({ status: "needs-setup" });
  });

  it("rejects a username or password that cannot be used", async () => {
    const bad = await server.call("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: "not an account", password: PASSWORD }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("username_invalid");
    const short = await server.call("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: "admin", password: "short" }) });
    expect(short.status).toBe(400);
    expect((await short.json()).error).toBe("password_too_short");
  });

  it("creates the administrator with the right code, then closes setup for good", async () => {
    const res = await server.call("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: "Admin", password: PASSWORD }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "needs-login", user: "admin" });
    expect(await (await server.call("/api/auth/session")).json()).toMatchObject({ status: "needs-login" });
    const again = await server.call("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: "second", password: PASSWORD }) });
    expect(again.status).toBe(403);
    expect((await again.json()).error).toBe("already_configured");
  });

  it("blocks mailbox and admin data without a session, and ignores a forged identity header", async () => {
    for (const pathname of ["/api/mailboxes", "/api/admin/setup", "/api/mailboxes/providers"]) {
      expect((await server.call(pathname)).status).toBe(401);
      expect((await server.call(pathname, { headers: { "x-lockbox-user": "admin" } })).status).toBe(401);
      expect((await server.call(pathname, { headers: { cookie: "lockbox_session=nonsense" } })).status).toBe(401);
    }
    expect((await server.call("/api/mailboxes", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
  });

  it("signs in with a cookie that scripts cannot read, and requires the CSRF token to change anything", async () => {
    const wrong = await server.call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "wrong password" }) });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe("invalid_credentials");

    const res = await server.call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", user: "admin" });
    const cookies = res.headers.getSetCookie?.() || [];
    expect(cookies.some(c => c.includes("lockbox_session=") && c.includes("HttpOnly") && c.includes("SameSite=Strict"))).toBe(true);
    expect(cookies.some(c => c.includes("lockbox_csrf=") && !c.includes("HttpOnly"))).toBe(true);
    const jar = `lockbox_session=${tokenOf(res)}; lockbox_csrf=${csrfOf(res)}`;

    expect(await (await server.call("/api/mailboxes", {}, jar)).json()).toEqual([]);
    const noCsrf = await server.call("/api/admin/setup", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicUrl: "https://mail.test" }) }, jar);
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error).toBe("csrf_check_failed");
    const withCsrf = await server.call("/api/admin/setup", { method: "PUT", headers: { "content-type": "application/json", "x-lockbox-csrf": csrfOf(res) }, body: JSON.stringify({ publicUrl: "https://mail.test" }) }, jar);
    expect(withCsrf.status).toBe(200);
    expect((await withCsrf.json()).publicUrl).toBe("https://mail.test");

    const out = await server.call("/api/auth/logout", { method: "POST", headers: { "x-lockbox-csrf": csrfOf(res) } }, jar);
    expect(out.status).toBe(200);
    expect((await server.call("/api/mailboxes", {}, jar)).status).toBe(401);
  });

  it("serves the AI endpoint only with a valid account API key", async () => {
    const login = await server.call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD }) });
    const jar = `lockbox_session=${tokenOf(login)}; lockbox_csrf=${csrfOf(login)}`;
    const created = await server.call("/api/ai/keys", { method: "POST", headers: { "content-type": "application/json", "x-lockbox-csrf": csrfOf(login) }, body: JSON.stringify({ name: "Security check" }) }, jar);
    expect(created.status).toBe(201);
    const key = (await created.json()).key as string;
    expect((await server.call("/api/ai/v1/messages")).status).toBe(401);
    expect((await server.call("/api/ai/v1/messages", { headers: { authorization: "Bearer lbx_wrongwrongwrongwrongwrong" } })).status).toBe(401);
    const allowed = await server.call("/api/ai/v1/messages", { headers: { authorization: `Bearer ${key}` } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    expect(await allowed.json()).toEqual({ messages: [] });
    expect((await server.call("/api/ai/v1/messages", { method: "POST", headers: { authorization: `Bearer ${key}` } })).status).toBe(405);
    expect((await server.call(`/api/ai/keys/${encodeURIComponent((await (await server.call("/api/ai/keys", {}, jar)).json())[0].id)}`, { method: "DELETE", headers: { "x-lockbox-csrf": csrfOf(login) } }, jar)).status).toBe(204);
    expect((await server.call("/api/ai/v1/messages", { headers: { authorization: `Bearer ${key}` } })).status).toBe(401);
  });

  it("keeps sessions, accounts and a closed setup across a restart", async () => {
    const res = await server.call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD }) });
    const jar = `lockbox_session=${tokenOf(res)}`;
    server.child.kill();
    await new Promise(r => setTimeout(r, 300));
    server = await startServer(dir);
    expect(server.log()).not.toMatch(CODE_RE);              // no new code after setup finished
    expect(await (await server.call("/api/mailboxes", {}, jar)).json()).toEqual([]);
    const again = await server.call("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: "second", password: PASSWORD }) });
    expect(again.status).toBe(403);
    expect((await again.json()).error).toBe("already_configured");
  });

  // Last, because it deliberately fills the sign-in allowance for this address.
  it("limits repeated sign-in attempts from one address", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await server.call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "nope nope nope" }) })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe("account store rules", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "lockbox-accounts-")); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const key = Buffer.alloc(32, 7);

  /** Boots a fresh store and returns the code exactly as the operator sees it: in the log. */
  async function fresh(dataDir: string, env: Record<string, string> = {}, now: () => number = () => Date.now()) {
    const logged: string[] = [];
    const auth = createAuth({ dataDir, key, env, now, log: (m: string) => logged.push(m) });
    await auth.bootstrap();
    return { auth, log: logged.join("\n"), code: logged.join("\n").match(/([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/)?.[1] || "" };
  }

  it("lets exactly one of five simultaneous setup attempts win", async () => {
    const { auth, code } = await fresh(mkdtempSync(path.join(dir, "race-")));
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => auth.completeSetup({ code, username: "racer", password: PASSWORD })),
    );
    expect(attempts.filter(a => a.status === "fulfilled")).toHaveLength(1);
    expect((await auth.login({ username: "racer", password: PASSWORD })).user).toBe("racer");
    await expect(auth.login({ username: "second", password: PASSWORD })).rejects.toMatchObject({ status: 401 });
    await expect(auth.completeSetup({ code, username: "second", password: PASSWORD })).rejects.toMatchObject({ status: 403 });
  });

  it("slides a busy session forward and drops an idle one", async () => {
    let t = 0;
    const { auth, code } = await fresh(mkdtempSync(path.join(dir, "expiry-")), {}, () => t);
    await auth.completeSetup({ code, username: "admin", password: PASSWORD });
    const { token } = await auth.login({ username: "admin", password: PASSWORD });
    expect(auth.validate(token)).toBeTruthy();
    t = 8 * 60 * 60 * 1000;                       // still inside the 12-hour window
    expect(auth.validate(token)).toBeTruthy();   // and it was extended
    t += 12 * 60 * 60 * 1000;                    // idle for a full lifetime from there
    expect(auth.validate(token)).toBeNull();
  });

  it("migrates an environment login to the same username without reopening setup", async () => {
    const { auth, log } = await fresh(mkdtempSync(path.join(dir, "migrate-")), { LOCKBOX_LOGIN_USER: "owner", LOCKBOX_LOGIN_PASSWORD: PASSWORD });
    expect(log).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/);   // no setup code was issued
    expect(auth.state(null)).toEqual({ status: "needs-login" });
    expect(auth.pendingSetup()).toBe(false);
    expect((await auth.login({ username: "owner", password: PASSWORD })).user).toBe("owner");
    expect(auth.isAdmin("owner")).toBe(true);
    expect(auth.isAdmin("someone-else")).toBe(false);
  });
});
