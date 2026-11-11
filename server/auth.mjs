// Lockbox accounts, sessions, first-run setup code and request limits.
//
// Rules this file exists to enforce:
//  - the setup code is only ever printed to the container log, never served to a browser;
//  - passwords are stored as a random-salted scrypt hash, never as text;
//  - the first administrator is created inside one serialized write, so two people
//    racing through the setup page can never both become admin;
//  - setup closes permanently the moment it succeeds;
//  - sessions are random tokens, stored only as a hash, with an expiry and a logout.
import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { encryptWith, decryptWith, writeAtomic } from './crypto.mjs';

export const SESSION_COOKIE = 'lockbox_session';
export const CSRF_COOKIE = 'lockbox_csrf';

export const SESSION_MS = 12 * 60 * 60 * 1000;      // 12 hours, slid forward as it is used
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1 so it can be read aloud
const USER_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MIN_PASSWORD = 10;
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const fail = (message, status) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest('hex');
const hashPassword = (password, salt) => new Promise((ok, bad) =>
  scrypt(password, salt, 64, SCRYPT_OPTS, (e, k) => (e ? bad(e) : ok(k))));
const constantEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const newCode = () => {
  const chars = Array.from(randomBytes(12), b => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
};
const normalizeUser = value => String(value ?? '').trim().toLowerCase();

/**
 * @param {object} options
 * @param {string} options.dataDir  folder on the persistent volume
 * @param {Buffer} options.key      32-byte store key
 * @param {object} [options.env]    environment (read for the legacy-login migration only)
 * @param {(msg: string) => void} [options.log]  writes that may name the setup code
 * @param {() => number} [options.now]
 */
export function createAuth({ dataDir, key, env = {}, log = () => {}, now = () => Date.now() }) {
  const accountsFile = path.join(dataDir, 'accounts.enc');
  const sessionsFile = path.join(dataDir, 'sessions.enc');
  let accounts = { users: [], setupCode: '', setupComplete: false };
  let sessions = {};
  let loaded = false;
  let queue = Promise.resolve();
  const buckets = new Map();

  const queued = fn => (queue = queue.then(fn, fn));
  const readStore = async (file, fallback) => {
    try { return decryptWith(key, await readFile(file)); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  };
  const saveAccounts = () => writeAtomic(accountsFile, encryptWith(key, accounts));
  const saveSessions = () => writeAtomic(sessionsFile, encryptWith(key, sessions));
  const pruneSessions = () => {
    const t = now();
    for (const [id, s] of Object.entries(sessions)) if (s.expiresAt <= t) delete sessions[id];
  };

  async function bootstrap() {
    if (loaded) return;
    loaded = true;
    accounts = await readStore(accountsFile, { users: [], setupCode: '', setupComplete: false });
    sessions = await readStore(sessionsFile, {});
    pruneSessions();
    if (!accounts.users.length && !accounts.setupComplete && env.LOCKBOX_LOGIN_PASSWORD) {
      // Migration: older installations put the admin password in the environment.
      // The same username keeps ownership of every mailbox already stored under it.
      const username = normalizeUser(env.LOCKBOX_LOGIN_USER) || 'owner';
      const password = String(env.LOCKBOX_LOGIN_PASSWORD);
      if (USER_RE.test(username) && password.length >= MIN_PASSWORD) {
        await addUser(username, password, true);
        accounts.setupComplete = true;
        accounts.setupCode = '';
        await saveAccounts();
        log(`Migrated the environment login to a stored account for "${username}". You can remove LOCKBOX_LOGIN_PASSWORD.`);
      } else {
        log('LOCKBOX_LOGIN_PASSWORD is set but is too short to migrate; use the first-run setup code instead.');
      }
    } else if (accounts.setupComplete && env.LOCKBOX_LOGIN_PASSWORD) {
      log('LOCKBOX_LOGIN_PASSWORD is ignored now that accounts are stored on the data volume.');
    }
    if (!accounts.setupComplete && !accounts.users.length) {
      accounts.setupCode = accounts.setupCode || newCode();
      await saveAccounts();
      log('Lockbox is not set up yet. Open the site and enter this one-time setup code:');
      log(`    ${accounts.setupCode}`);
      log('The code is shown here only, never in a browser. Setup closes for good once an account exists.');
    }
    await saveSessions();
  }

  async function addUser(username, password, admin = false) {
    const salt = randomBytes(16);
    accounts.users.push({
      username, admin,
      salt: salt.toString('base64'),
      hash: (await hashPassword(password, salt)).toString('base64'),
      createdAt: new Date(now()).toISOString(),
    });
  }

  // A wrong username still costs a full hash, so timing cannot reveal which names exist.
  const DUMMY_SALT = randomBytes(16);
  const spendTime = () => hashPassword('not-the-password', DUMMY_SALT);

  function take(keyId, max, windowMs) {
    const t = now();
    const b = buckets.get(keyId) || { n: 0, resetAt: t + windowMs };
    if (t > b.resetAt) { b.n = 0; b.resetAt = t + windowMs; }
    b.n += 1;
    buckets.set(keyId, b);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt < t) buckets.delete(k);
    return b.n <= max;
  }

  async function completeSetup({ code, username, password }) {
    return queued(async () => {
      if (accounts.setupComplete || accounts.users.length) throw fail('already_configured', 403);
      const given = String(code ?? '').trim().toUpperCase();
      if (!accounts.setupCode || !constantEqual(given, accounts.setupCode)) throw fail('setup_code_incorrect', 403);
      const user = normalizeUser(username);
      if (!USER_RE.test(user)) throw fail('username_invalid', 400);
      if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 400) throw fail('password_too_short', 400);
      await addUser(user, password, true);
      accounts.setupComplete = true;
      accounts.setupCode = '';
      await saveAccounts();
      log(`Setup complete: administrator "${user}" created and first-run setup is closed.`);
      return { user };
    });
  }

  async function login({ username, password }) {
    const user = normalizeUser(username);
    const record = accounts.users.find(u => u.username === user);
    const check = record
      ? hashPassword(String(password ?? ''), Buffer.from(record.salt, 'base64'))
      : spendTime();
    const [hash] = await Promise.all([check, record ? Promise.resolve() : spendTime()]);
    if (!record || !constantEqual(hash.toString('base64'), record.hash)) throw fail('invalid_credentials', 401);
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    pruneSessions();
    sessions[digest(token)] = { user, expiresAt: now() + SESSION_MS, csrf };
    await saveSessions();
    return { user, token, csrf, maxAge: Math.floor(SESSION_MS / 1000) };
  }

  function validate(token) {
    if (!token) return null;
    const id = digest(token);
    const s = sessions[id];
    if (!s) return null;
    const t = now();
    if (s.expiresAt <= t) { delete sessions[id]; void queued(saveSessions); return null; }
    if (s.expiresAt - t < SESSION_MS / 2) {
      s.expiresAt = t + SESSION_MS;
      void queued(saveSessions);
    }
    return s;
  }

  async function logout(token) {
    if (!token) return;
    delete sessions[digest(token)];
    await queued(saveSessions);
  }

  return {
    bootstrap,
    completeSetup,
    login,
    validate,
    logout,
    /** 'needs-setup' before an admin exists, 'needs-login' until a session cookie is presented. */
    state(user) {
      if (user) return { status: 'ok', user };
      return accounts.setupComplete || accounts.users.length ? { status: 'needs-login' } : { status: 'needs-setup' };
    },
    isAdmin: user => !!user && accounts.users[0]?.username === user && accounts.users[0]?.admin === true,
    limit: (id, kind) => (kind === 'setup' ? take(`setup:${id}`, 10, 15 * 60_000) : take(`login:${id}`, 10, 5 * 60_000)),
    pendingSetup: () => !accounts.setupComplete && !accounts.users.length,
  };
}
