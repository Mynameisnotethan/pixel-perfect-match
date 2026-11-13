// Lockbox Docker backend: browser sign-in, first-run setup, web OAuth callbacks,
// encrypted token storage, sync + send.
// Client secrets, passwords and mailbox tokens stay on this server; the browser only sees
// mailbox metadata and a session cookie it cannot forge.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { createPkce, buildAuthUrl, exchangeCode, stateMatches, ensureFresh, ReconnectRequired } from '../connectors/oauth.mjs';
import { mail, upsertMailbox } from '../connectors/mail.mjs';
import { normalizeOutgoing } from '../connectors/outgoing.mjs';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { createImapClient, normalizeImap } from '../connectors/imap.mjs';
import { startDeviceCode, pollDeviceCode } from '../connectors/device.mjs';
import { setupView, applySetup } from './setup.mjs';
import { createAuth, SESSION_COOKIE, CSRF_COOKIE } from './auth.mjs';
import { createKeyStore } from './apikeys.mjs';
import { createPrivacyStore } from './privacy-store.mjs';
import { createAiRoutes, buildFeed } from '../connectors/ai-feed.mjs';
import { encryptWith, decryptWith, writeAtomic } from './crypto.mjs';

const env = process.env;
const DATA_DIR = env.LOCKBOX_DATA_DIR || '/data';
const STORE = path.join(DATA_DIR, 'mailboxes.enc');
const CONFIG = path.join(DATA_DIR, 'config.enc');
// Token key: env wins; otherwise one is generated once and kept on the data volume (back up the volume).
async function loadKey() {
  if (env.LOCKBOX_TOKEN_KEY) return Buffer.from(env.LOCKBOX_TOKEN_KEY, 'base64');
  const f = path.join(DATA_DIR, 'token.key');
  try { return Buffer.from((await readFile(f, 'utf8')).trim(), 'base64'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const k = randomBytes(32); await mkdir(DATA_DIR, { recursive: true }); await writeFile(f, k.toString('base64'), { mode: 0o600 }); return k;
}
const KEY = await loadKey();
if (KEY.length !== 32) throw new Error('LOCKBOX_TOKEN_KEY must be 32 random bytes, base64-encoded');

const encrypt = encryptWith.bind(null, KEY);
const decrypt = decryptWith.bind(null, KEY);
const aiKeys = createKeyStore({ file: path.join(DATA_DIR, 'apikeys.enc'), encrypt: (...a) => encrypt(...a), decrypt: (...a) => decrypt(...a) });
const privacy = createPrivacyStore({ file: path.join(DATA_DIR, 'privacy.enc'), encrypt: (...a) => encrypt(...a), decrypt: (...a) => decrypt(...a) });
const auth = createAuth({ dataDir: DATA_DIR, key: KEY, env, log: m => console.log(`[lockbox] ${m}`) });

// ---- encrypted, restart-safe store: { [userId]: [{ id, provider, email, status, tokens }] }
async function load() { try { return decrypt(await readFile(STORE)); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } }
let queue = Promise.resolve();
const mutate = fn => (queue = queue.then(async () => { const db = await load(); const out = await fn(db); await writeAtomic(STORE, encrypt(db)); return out; }));

// ---- instance settings from the Setup wizard (encrypted on the volume; env vars win)
let config = {};
const loadConfig = async () => { try { config = decrypt(await readFile(CONFIG)); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
const saveConfig = async next => { await writeAtomic(CONFIG, encrypt(next)); config = next; };
// Address this server is reached at. An explicit LOCKBOX_PUBLIC_URL wins, then whatever the Setup
// page saved, then the deployment's LOCKBOX_DOMAIN (https + that host) as a convenience default.
const derivedUrl = () => {
  const host = String(env.LOCKBOX_DOMAIN || '').replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  return host ? `https://${host}` : '';
};
const publicUrl = () => (env.LOCKBOX_PUBLIC_URL || config.publicUrl || derivedUrl()).replace(/\/$/, '');
const redirectFor = provider => `${publicUrl()}/oauth/${provider}/callback`;
const webClient = provider => provider === 'google'
  ? { clientId: env.LOCKBOX_GOOGLE_CLIENT_ID || config.google?.clientId, clientSecret: env.LOCKBOX_GOOGLE_CLIENT_SECRET || config.google?.clientSecret }
  : { clientId: env.LOCKBOX_MS_CLIENT_ID || config.microsoft?.clientId, clientSecret: env.LOCKBOX_MS_CLIENT_SECRET || config.microsoft?.clientSecret };
const deviceClientId = () => env.LOCKBOX_MS_DEVICE_CLIENT_ID || config.microsoftDevice?.clientId || '';
// Device tokens remember which client issued them, so changing Setup does not break refresh.
const clientFor = box => box.via === 'device' ? { clientId: box.authClientId || deviceClientId() } : webClient(box.provider);
const microsoftMode = () => (webClient('microsoft').clientId ? 'web' : deviceClientId() ? 'device' : 'none');
// Tests point at a local fake mail server; production never allows private hosts.
const allowPrivate = env.LOCKBOX_IMAP_ALLOW_PRIVATE === '1' && env.NODE_ENV !== 'production';
const imap = createImapClient({ ImapFlow, nodemailer, allowPrivate });
const devices = new Map(); // handle -> { user, clientId, deviceCode, expiresAt }
const pending = new Map(); // state -> { verifier, provider, user, at }

// ---- request helpers
const publicBox = ({ tokens, authClientId, imap: settings, ...b }) => (settings ? { ...b, settings: { username: settings.username, name: settings.name, imap: settings.imap, smtp: settings.smtp, hasPassword: !!settings.password } } : b);
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const readJson = (req, limit = 1e6) => new Promise((ok, bad) => {
  let s = '';
  let size = 0;
  let done = false;
  req.on('data', c => {
    if (done) return;
    size += c.length;
    if (size > limit) { done = true; bad(Object.assign(new Error('request_too_large'), { status: 413 })); return; }
    s += c;
  });
  req.on('end', () => { if (done) return; try { ok(JSON.parse(s || '{}')); } catch (e) { bad(e); } });
  req.on('error', bad);
});
const cookiesOf = req => Object.fromEntries((req.headers.cookie || '').split(';').map(p => { const i = p.indexOf('='); return i < 0 ? [] : [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())]; }).filter(e => e.length));
// Caddy ends TLS and tells us over X-Forwarded-Proto, so cookies get the Secure flag in production
// while a plain-http test server can still set them.
const secureCookies = req => (req.headers['x-forwarded-proto'] || '').includes('https') || /^https:\/\//.test(publicUrl());
const cookie = (name, value, { maxAge, httpOnly = true, secure }) => [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Strict', httpOnly ? 'HttpOnly' : '', secure ? 'Secure' : ''].filter(Boolean).join('; ');
const ipOf = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

async function withToken(user, id, fn) {
  const box = (await load())[user]?.find(b => b.id === id);
  if (!box) throw Object.assign(new Error('not_found'), { status: 404 });
  if (box.provider === 'imap') {
    try { return await fn(null, box); }
    catch (e) { if (['wrong_password', 'app_password_needed'].includes(e.message)) await mutate(db => { const b = db[user].find(x => x.id === id); if (b) b.status = 'reconnect'; }); throw e; }
  }
  try {
    const t = await ensureFresh(box.provider, box.tokens, clientFor(box), next => mutate(db => { const b = db[user].find(x => x.id === id); b.tokens = next; b.status = 'connected'; }));
    return await fn(t.accessToken, box);
  } catch (e) {
    if (e instanceof ReconnectRequired || e.status === 401) { await mutate(db => { const b = db[user].find(x => x.id === id); if (b) b.status = 'reconnect'; }); throw Object.assign(new Error('reconnect_required'), { status: 409 }); }
    throw e;
  }
}

// AI agents: a personal API key maps to exactly one user; only that user's mailboxes and rules are used.
const aiRoutes = createAiRoutes({
  verifyKey: key => aiKeys.verify(key),
  feedFor: async (owner, { mailbox }) => buildFeed({
    boxes: (await load())[owner] || [], mailbox, privacy: await privacy.get(owner),
    fetchInbox: box => withToken(owner, box.id, (t, b) => b.provider === 'imap' ? imap.inbox(b.imap) : mail[b.provider].inbox(t)),
  }),
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const cookies = cookiesOf(req);
  const session = auth.validate(cookies[SESSION_COOKIE]);
  // Identity comes from the signed-in session only. A client-supplied header is never trusted.
  const user = session?.user || null;
  const secure = secureCookies(req);
  try {
    // State-changing calls from a signed-in browser must echo the session's CSRF token.
    if (session && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers[CSRF_COOKIE] !== session.csrf
      && req.headers['x-lockbox-csrf'] !== session.csrf) return send(res, 403, { error: 'csrf_check_failed' });

    let m;
    if (url.pathname === '/api/auth/session') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
      return send(res, 200, { ...auth.state(user), csrf: session?.csrf || null });
    }
    if (url.pathname === '/api/auth/setup' && req.method === 'POST') {
      if (!auth.limit(ipOf(req), 'setup')) return send(res, 429, { error: 'too_many_attempts' });
      const { user: made } = await auth.completeSetup(await readJson(req));
      return send(res, 200, { status: 'needs-login', user: made });
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!auth.limit(ipOf(req), 'login')) return send(res, 429, { error: 'too_many_attempts' });
      const { user: name, token, csrf, maxAge } = await auth.login(await readJson(req));
      return send(res, 200, { status: 'ok', user: name, csrf }, {
        'Set-Cookie': [cookie(SESSION_COOKIE, token, { maxAge, secure }), cookie(CSRF_COOKIE, csrf, { maxAge, httpOnly: false, secure })],
      });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      await auth.logout(cookies[SESSION_COOKIE]);
      return send(res, 200, { status: 'needs-login' }, {
        'Set-Cookie': [cookie(SESSION_COOKIE, '', { maxAge: 0, secure }), cookie(CSRF_COOKIE, '', { maxAge: 0, httpOnly: false, secure })],
      });
    }
    if ((m = url.pathname.match(/^\/oauth\/(google|microsoft)\/start$/))) {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      const provider = m[1]; const client = webClient(provider); if (!client.clientId || !publicUrl()) return send(res, 503, { error: 'provider_not_configured' });
      const { verifier, challenge, state } = await createPkce();
      pending.set(state, { verifier, provider, user, at: Date.now() });
      return send(res, 302, undefined, { Location: buildAuthUrl(provider, { clientId: client.clientId, redirectUri: redirectFor(provider), challenge, state }) });
    }
    if ((m = url.pathname.match(/^\/oauth\/(google|microsoft)\/callback$/))) {
      const state = url.searchParams.get('state') || '';
      const entry = [...pending.entries()].find(([s]) => stateMatches(s, state));
      if (entry) pending.delete(entry[0]);
      const p = entry?.[1];
      // The browser that started the connect must be the one finishing it.
      if (!p || p.provider !== m[1] || Date.now() - p.at > 10 * 60_000 || p.user !== user || !url.searchParams.get('code')) return send(res, 302, undefined, { Location: '/?mailbox=failed' });
      const tokens = await exchangeCode(p.provider, { code: url.searchParams.get('code'), verifier: p.verifier, redirectUri: redirectFor(p.provider), ...webClient(p.provider) });
      const { email } = await mail[p.provider].profile(tokens.accessToken);
      await mutate(db => { db[user] = upsertMailbox(db[user] || [], { id: `${p.provider}:${email.toLowerCase()}`, provider: p.provider, email, status: 'connected', via: 'web', tokens }); });
      return send(res, 302, undefined, { Location: '/?mailbox=connected' });
    }
    if (url.pathname === '/api/admin/setup') {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      if (!auth.isAdmin(user)) return send(res, 403, { error: 'admin_only' });
      if (req.method === 'PUT') await saveConfig(applySetup(config, await readJson(req)));
      else if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
      return send(res, 200, setupView({ config, env, publicUrl: publicUrl(), microsoftMode: microsoftMode(), deviceAvailable: !!deviceClientId() }));
    }
    if (url.pathname === '/api/mailboxes/providers') {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      return send(res, 200, { google: webClient('google').clientId && publicUrl() ? 'web' : 'none', microsoft: microsoftMode(), isAdmin: auth.isAdmin(user) });
    }
    if ((url.pathname === '/api/mailboxes/imap/test' || url.pathname === '/api/mailboxes/imap') && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      if (!auth.limit(`${user}:${ipOf(req)}`, 'imap')) return send(res, 429, { error: 'too_many_attempts' });
      const body = await readJson(req);
      const id = `imap:${String(body.email || '').trim().toLowerCase()}`;
      // Editing without retyping the password keeps the saved one.
      const prev = ((await load())[user] || []).find(b => b.id === id)?.imap;
      const s = normalizeImap({ ...body, password: body.password || prev?.password || '' }, { allowPrivate });
      if (!s.password) return send(res, 400, { error: 'password_required' });
      await imap.test(s);
      if (url.pathname.endsWith('/test')) return send(res, 200, { ok: true });
      const box = await mutate(db => { db[user] = upsertMailbox(db[user] || [], { id, provider: 'imap', email: s.email, status: 'connected', via: 'imap', imap: s }); return db[user].find(b => b.id === id); });
      return send(res, 200, publicBox(box));
    }
    if (url.pathname === '/api/mailboxes/device/start' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      const clientId = deviceClientId();
      if (!clientId) return send(res, 503, { error: 'provider_not_configured' });
      const d = await startDeviceCode(clientId);
      const handle = randomBytes(18).toString('base64url');
      devices.set(handle, { user, clientId, deviceCode: d.deviceCode, expiresAt: d.expiresAt });
      return send(res, 200, { handle, userCode: d.userCode, verificationUri: d.verificationUri, expiresAt: d.expiresAt, interval: d.interval });
    }
    if (url.pathname === '/api/mailboxes/device/poll' && req.method === 'POST') {
      const { handle } = await readJson(req);
      const d = devices.get(handle);
      if (!user || !d || d.user !== user) return send(res, 404, { error: 'not_found' });
      if (Date.now() > d.expiresAt) { devices.delete(handle); return send(res, 410, { error: 'expired: The code expired. Start again.' }); }
      let r;
      try { r = await pollDeviceCode(d.clientId, d.deviceCode); } catch (e) { devices.delete(handle); return send(res, 400, { error: e.message }); }
      if (r.status !== 'done') return send(res, 200, { status: r.status });
      devices.delete(handle);
      const { email } = await mail.microsoft.profile(r.tokens.accessToken);
      const box = await mutate(db => { db[user] = upsertMailbox(db[user] || [], { id: `microsoft:${email.toLowerCase()}`, provider: 'microsoft', email, status: 'connected', via: 'device', authClientId: d.clientId, tokens: r.tokens }); return db[user].find(b => b.id === `microsoft:${email.toLowerCase()}`); });
      return send(res, 200, { status: 'done', mailbox: publicBox(box) });
    }
    if (await aiRoutes(req, res, url)) return;
    if (url.pathname === '/api/privacy') {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      if (req.method === 'GET') return send(res, 200, (await privacy.get(user)) || { rules: {}, defaults: null, labels: null });
      if (req.method === 'PUT') { await privacy.put(user, await readJson(req)); return send(res, 204); }
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (url.pathname === '/api/ai/keys' || url.pathname.startsWith('/api/ai/keys/')) {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      const keyId = decodeURIComponent(url.pathname.slice('/api/ai/keys/'.length) || '');
      if (req.method === 'GET' && !keyId) return send(res, 200, await aiKeys.list(user));
      if (req.method === 'POST' && !keyId) return send(res, 201, await aiKeys.create(user, (await readJson(req)).name));
      if (req.method === 'DELETE' && keyId) return (await aiKeys.remove(user, keyId)) ? send(res, 204) : send(res, 404, { error: 'not_found' });
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (!url.pathname.startsWith('/api/mailboxes')) return send(res, 404, { error: 'not_found' });
    if (!user) return send(res, 401, { error: 'sign_in_required' });
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const action = url.pathname.split('/')[4];
    if (req.method === 'GET' && !id) return send(res, 200, ((await load())[user] || []).map(publicBox));
    if (req.method === 'GET' && action === 'inbox') return send(res, 200, await withToken(user, id, (t, b) => b.provider === 'imap' ? imap.inbox(b.imap) : mail[b.provider].inbox(t)));
    if (req.method === 'POST' && action === 'send') {
      const message = normalizeOutgoing(await readJson(req, 40 * 1024 * 1024));
      await withToken(user, id, (t, b) => b.provider === 'imap' ? imap.send(b.imap, message) : mail[b.provider].send(t, b.email, message));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'DELETE' && id) { await mutate(db => { db[user] = (db[user] || []).filter(b => b.id !== id); }); return send(res, 204); }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error(`[lockbox] ${req.method} ${url.pathname}: ${e.message}`); // message only, never passwords, tokens or query strings
    return send(res, e.status || 500, { error: e.message });
  }
}).listen(Number(env.PORT || 3000), async () => { await loadConfig(); await auth.bootstrap(); console.log(`[lockbox] mailbox server on :${env.PORT || 3000}`); });
