// Lockbox Docker backend: web OAuth callbacks, encrypted token storage, sync + send.
// Client secrets and tokens stay on this server; the browser only sees mailbox metadata.
import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { createPkce, buildAuthUrl, exchangeCode, stateMatches, ensureFresh, ReconnectRequired } from '../connectors/oauth.mjs';
import { mail, upsertMailbox } from '../connectors/mail.mjs';

const env = process.env;
const PUBLIC_URL = (env.LOCKBOX_PUBLIC_URL || '').replace(/\/$/, '');
const DATA_DIR = env.LOCKBOX_DATA_DIR || '/data';
const STORE = path.join(DATA_DIR, 'mailboxes.enc');
const KEY = Buffer.from(env.LOCKBOX_TOKEN_KEY || '', 'base64');
if (!PUBLIC_URL.startsWith('https://') && !env.LOCKBOX_ALLOW_HTTP) throw new Error('LOCKBOX_PUBLIC_URL must be an https:// URL');
if (KEY.length !== 32) throw new Error('LOCKBOX_TOKEN_KEY must be 32 random bytes, base64-encoded');

const clients = {
  google: { clientId: env.LOCKBOX_GOOGLE_CLIENT_ID, clientSecret: env.LOCKBOX_GOOGLE_CLIENT_SECRET },
  microsoft: { clientId: env.LOCKBOX_MS_CLIENT_ID, clientSecret: env.LOCKBOX_MS_CLIENT_SECRET },
};
const redirectFor = provider => `${PUBLIC_URL}/oauth/${provider}/callback`;

// ---- encrypted, restart-safe store: { [userId]: [{ id, provider, email, status, tokens }] }
const encrypt = obj => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', KEY, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); };
const decrypt = buf => { const d = createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString()); };
async function load() { try { return decrypt(await readFile(STORE)); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } }
let queue = Promise.resolve();
const mutate = fn => (queue = queue.then(async () => { const db = await load(); const out = await fn(db); await mkdir(DATA_DIR, { recursive: true }); await writeFile(STORE + '.tmp', encrypt(db)); await rename(STORE + '.tmp', STORE); return out; }));

// ---- Lockbox user: supplied by the authenticating reverse proxy in front of this container.
function userOf(req) {
  const header = env.LOCKBOX_USER_HEADER; // e.g. "x-forwarded-user"
  if (header) return req.headers[header.toLowerCase()] || null;
  return env.LOCKBOX_SINGLE_USER ? 'owner' : null;
}

const pending = new Map(); // state -> { verifier, provider, user, at }
const publicBox = ({ tokens, ...b }) => b;
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const readJson = req => new Promise((ok, bad) => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { bad(e); } }); });

async function withToken(user, id, fn) {
  const box = (await load())[user]?.find(b => b.id === id);
  if (!box) throw Object.assign(new Error('not_found'), { status: 404 });
  try {
    const t = await ensureFresh(box.provider, box.tokens, clients[box.provider], next => mutate(db => { const b = db[user].find(x => x.id === id); b.tokens = next; b.status = 'connected'; }));
    return await fn(t.accessToken, box);
  } catch (e) {
    if (e instanceof ReconnectRequired || e.status === 401) { await mutate(db => { const b = db[user].find(x => x.id === id); if (b) b.status = 'reconnect'; }); throw Object.assign(new Error('reconnect_required'), { status: 409 }); }
    throw e;
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL || 'http://localhost');
  const user = userOf(req);
  try {
    let m;
    if ((m = url.pathname.match(/^\/oauth\/(google|microsoft)\/start$/))) {
      if (!user) return send(res, 401, { error: 'sign_in_required' });
      const provider = m[1]; if (!clients[provider].clientId) return send(res, 503, { error: 'provider_not_configured' });
      const { verifier, challenge, state } = await createPkce();
      pending.set(state, { verifier, provider, user, at: Date.now() });
      return send(res, 302, undefined, { Location: buildAuthUrl(provider, { clientId: clients[provider].clientId, redirectUri: redirectFor(provider), challenge, state }) });
    }
    if ((m = url.pathname.match(/^\/oauth\/(google|microsoft)\/callback$/))) {
      const state = url.searchParams.get('state') || '';
      const entry = [...pending.entries()].find(([s]) => stateMatches(s, state));
      if (entry) pending.delete(entry[0]);
      const p = entry?.[1];
      if (!p || p.provider !== m[1] || Date.now() - p.at > 10 * 60_000 || p.user !== user || !url.searchParams.get('code')) return send(res, 302, undefined, { Location: '/?mailbox=failed' });
      const tokens = await exchangeCode(p.provider, { code: url.searchParams.get('code'), verifier: p.verifier, redirectUri: redirectFor(p.provider), ...clients[p.provider] });
      const { email } = await mail[p.provider].profile(tokens.accessToken);
      await mutate(db => { db[user] = upsertMailbox(db[user] || [], { id: `${p.provider}:${email.toLowerCase()}`, provider: p.provider, email, status: 'connected', tokens }); });
      return send(res, 302, undefined, { Location: '/?mailbox=connected' });
    }
    if (!url.pathname.startsWith('/api/mailboxes')) return send(res, 404, { error: 'not_found' });
    if (!user) return send(res, 401, { error: 'sign_in_required' });
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const action = url.pathname.split('/')[4];
    if (req.method === 'GET' && !id) return send(res, 200, ((await load())[user] || []).map(publicBox));
    if (req.method === 'GET' && action === 'inbox') return send(res, 200, await withToken(user, id, (t, b) => mail[b.provider].inbox(t)));
    if (req.method === 'POST' && action === 'send') {
      const { to, subject = '', body = '' } = await readJson(req);
      if (typeof to !== 'string' || !/^[^\s@,]+@[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+)*$/.test(to) || subject.length > 998 || body.length > 500_000) return send(res, 400, { error: 'invalid_message' });
      await withToken(user, id, (t, b) => mail[b.provider].send(t, b.email, { to, subject, body }));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'DELETE' && id) { await mutate(db => { db[user] = (db[user] || []).filter(b => b.id !== id); }); return send(res, 204); }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error(`[lockbox] ${req.method} ${url.pathname}: ${e.message}`); // message only, never tokens or query strings
    return send(res, e.status || 500, { error: e.message });
  }
}).listen(Number(env.PORT || 3000), () => console.log(`[lockbox] mailbox server on :${env.PORT || 3000}`));
