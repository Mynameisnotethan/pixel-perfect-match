import { can } from './ai-perms.mjs';
// Native MCP (Model Context Protocol) endpoint for AI agents: POST /api/ai/v1/mcp.
// Stateless Streamable HTTP, JSON responses only. Two read-only tools over the same redacted feed
// as the REST API, so redaction and "reviewed only" rules are identical.
// Also a small OAuth 2.1 bridge (PKCE S256, dynamic client registration) for clients such as
// ChatGPT that only accept OAuth: the owner pastes an lbx_ key once on the authorize page and the
// client receives tokens tied to that key. Each token is re-checked against the key store on every
// call, so deleting the key cuts the client off immediately.
import { createHash, randomBytes } from 'node:crypto';

export const MCP_PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const sha = s => createHash('sha256').update(String(s)).digest('hex');
const rand = () => randomBytes(32).toString('base64url');
const ACCESS_TTL = 60 * 60_000, REFRESH_TTL = 30 * 24 * 60 * 60_000, CODE_TTL = 5 * 60_000;

export const MCP_TOOLS = [
  {
    name: 'list_messages', title: 'List emails',
    description: 'List recent emails the owner has reviewed, newest first. Hidden parts appear as [hidden: Label].',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many emails (default 25).' },
      mailbox: { type: 'string', maxLength: 300, description: 'Only this mailbox id, e.g. google:me@gmail.com.' },
    } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_message', title: 'Read one email',
    description: 'Read one reviewed email by id. Hidden parts appear as [hidden: Label]; never guess them.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 400 } } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];
const addrList = d => ({ anyOf: [{ type: 'string', maxLength: 20000 }, { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 320 } }], description: d });
export const DRAFT_TOOLS = [
  {
    name: 'create_draft', title: 'Create email draft',
    description: 'Create a draft in one of the owner\'s Gmail or Outlook mailboxes, either a new email or a reply to a reviewed email. Returns the draft id and a preview. Replies go to the original sender only unless reply_all is true or you add recipients; the original is never quoted.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      mailbox: { type: 'string', maxLength: 300, description: 'Sending mailbox id, e.g. google:me@gmail.com. Optional for replies.' },
      reply_to_message_id: { type: 'string', maxLength: 400, description: 'id of a reviewed email (from list_messages) to reply to.' },
      reply_all: { type: 'boolean', description: 'Reply to everyone on the original email. Only when the owner asked for it.' },
      to: addrList('Recipients (added to the original sender for replies).'), cc: addrList('CC recipients.'), bcc: addrList('BCC recipients.'),
      subject: { type: 'string', maxLength: 998, description: 'Subject. For replies, defaults to "Re: " + the original subject.' },
      body: { type: 'string', maxLength: 200000, description: 'Plain-text body.' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'update_draft', title: 'Edit email draft',
    description: 'Change a draft made with create_draft. Only the fields you pass change. Any change cancels an earlier send approval.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['draft_id'], properties: {
      draft_id: { type: 'string', maxLength: 100 }, mailbox: { type: 'string', maxLength: 300, description: 'Move a new (non-reply) draft to another mailbox.' },
      to: addrList('Replaces the recipients you added.'), cc: addrList('Replaces CC recipients you added.'), bcc: addrList('Replaces BCC recipients.'),
      subject: { type: 'string', maxLength: 998 }, body: { type: 'string', maxLength: 200000 },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
export const SEND_TOOL = {
  name: 'send_draft', title: 'Send approved draft',
  description: 'Send a draft once the owner has approved this exact version in Lockbox. If not approved yet, returns status approval_required and an approval_url for the owner; nothing is sent. Safe to call again: an approved version is sent at most once.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['draft_id'], properties: {
    draft_id: { type: 'string', maxLength: 100 }, version: { type: 'integer', minimum: 1, description: 'The version shown to the owner. Send fails if the draft changed.' },
  } },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};
/** Tools this key may use. */
export const toolsFor = (perms = {}, drafts = null) => [
  ...(perms.read !== false ? MCP_TOOLS : []),
  ...(drafts && perms.drafts ? DRAFT_TOOLS : []),
  ...(drafts && perms.send ? [SEND_TOOL] : []),
];
const INSTRUCTIONS = 'Access to the owner\'s Lockbox mailbox, limited by what their API key allows. Only emails the owner reviewed are shared. Text shown as [hidden: Label] was hidden by the owner: never guess or ask for it. Some keys may also create and edit drafts; sending always needs the owner to approve the exact email in Lockbox. Never claim an email was sent unless send_draft returned status sent.';

/** Pure JSON-RPC handling for one MCP message. Returns a response object, or null for notifications. */
export async function handleMcpMessage(msg, { user, feedFor, perms = { read: true }, keyId = null, drafts = null, base = '' }) {
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (msg.id === undefined) return null; // notification (e.g. notifications/initialized)
  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize': return ok({
      protocolVersion: SUPPORTED.includes(p.protocolVersion) ? p.protocolVersion : MCP_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'lockbox', title: 'Lockbox', version: '1.0.0' },
      instructions: INSTRUCTIONS,
    });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: toolsFor(perms, drafts) });
    case 'tools/call': {
      const a = p.arguments || {};
      const toolErr = text => ok({ content: [{ type: 'text', text }], isError: true });
      if (typeof a !== 'object' || Array.isArray(a)) return toolErr('Arguments must be an object.');
      const allowed = toolsFor(perms, drafts).map(t => t.name);
      if ([...MCP_TOOLS, ...DRAFT_TOOLS, SEND_TOOL].some(t => t.name === p.name) && !allowed.includes(p.name)) return toolErr('This API key is not allowed to use that tool. The owner can change key permissions in Lockbox → AI Access.');
      const draftCall = async (fn, keys) => {
        const extra = Object.keys(a).filter(k => !keys.includes(k));
        if (extra.length) return toolErr(`Unknown argument: ${extra[0]}`);
        try { const r = await fn(); return ok({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r }); }
        catch (e) { if (e.status && e.status < 500 || e.status === 502) return toolErr(e.message); throw e; }
      };
      const who = { user, keyId, perms };
      if (p.name === 'create_draft') return draftCall(() => drafts.create(who, a), ['mailbox', 'reply_to_message_id', 'reply_all', 'to', 'cc', 'bcc', 'subject', 'body']);
      if (p.name === 'update_draft') return draftCall(() => drafts.update(who, a), ['draft_id', 'mailbox', 'to', 'cc', 'bcc', 'subject', 'body']);
      if (p.name === 'send_draft') return draftCall(() => drafts.send(who, a, { approvalUrl: id => `${base}/api/ai/approve/${encodeURIComponent(id)}` }), ['draft_id', 'version']);
      if (p.name === 'list_messages') {
        const extra = Object.keys(a).filter(k => !['limit', 'mailbox'].includes(k));
        if (extra.length) return toolErr(`Unknown argument: ${extra[0]}`);
        if (a.mailbox !== undefined && (typeof a.mailbox !== 'string' || a.mailbox.length > 300)) return toolErr('mailbox must be a string.');
        const n = Math.min(Math.max(Math.trunc(Number(a.limit)) || 25, 1), 100);
        const messages = (await feedFor(user, { mailbox: a.mailbox || undefined })).slice(0, n);
        return ok({ content: [{ type: 'text', text: JSON.stringify({ messages }) }], structuredContent: { messages } });
      }
      if (p.name === 'get_message') {
        const extra = Object.keys(a).filter(k => k !== 'id');
        if (extra.length) return toolErr(`Unknown argument: ${extra[0]}`);
        if (typeof a.id !== 'string' || !a.id || a.id.length > 400) return toolErr('id is required.');
        const one = (await feedFor(user, {})).find(m => m.id === a.id);
        if (!one) return toolErr('Not found, or not shared with AI (unreviewed).');
        return ok({ content: [{ type: 'text', text: JSON.stringify(one) }], structuredContent: { message: one } });
      }
      return fail(-32602, `Unknown tool: ${p.name}`);
    }
    default: return fail(-32601, 'Method not found');
  }
}

/** In-memory OAuth store; pass { read, write } (e.g. an encrypted file) to persist across restarts. */
export function createOAuthStore({ read, write } = {}) {
  let db = null; let queue = Promise.resolve();
  const load = async () => (db ||= { clients: {}, tokens: {}, ...(read ? await read() : {}) });
  const mutate = fn => (queue = queue.then(async () => {
    const d = await load(); const now = Date.now();
    for (const [h, t] of Object.entries(d.tokens)) if (t.exp < now) delete d.tokens[h];
    const out = await fn(d); if (write) await write(d); return out;
  }));
  return { mutate, get: async () => load() };
}

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const authorizePage = (q, error) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Lockbox</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f6;color:#1d2b2b;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#fff;padding:28px;border-radius:12px;max-width:420px;width:90%;box-shadow:0 4px 20px #0001}h1{font-size:20px;margin:0 0 8px}p{color:#4c5b5b;font-size:14px}input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9d3d3;border-radius:8px;font:inherit}button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:8px;background:#0f766e;color:#fff;font:inherit;cursor:pointer}.err{color:#b42318}</style></head>
<body><form method="post" action="/api/ai/v1/oauth/authorize"><h1>Connect an AI app to Lockbox</h1>
<p><strong>${esc(q.client_name || 'An AI app')}</strong> wants to use your Lockbox mailbox with the permissions of the key below (by default: read reviewed emails only). Hidden parts stay hidden, and nothing is sent without your approval.</p>
<p>Paste a Lockbox API key (from AI Access). Deleting that key later disconnects this app.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
${['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'].map(k => `<input type="hidden" name="${k}" value="${esc(q[k] || '')}">`).join('')}
<input type="password" name="api_key" placeholder="lbx_..." autocomplete="off" required autofocus>
<button type="submit">Allow access</button></form></body></html>`;

const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > 64 * 1024) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
});
const parseForm = (text, type = '') => /json/.test(type) ? JSON.parse(text || '{}') : Object.fromEntries(new URLSearchParams(text));
const validRedirect = u => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname)); } catch { return false; } };

/**
 * MCP + OAuth routes. Returns true when the request was handled.
 * verifyKey(lbxKey) -> user|null. feedFor(user, opts) -> redacted feed. oauth: store or null to disable.
 */
export function createMcpRoutes({ verifyKey, inspectKey = null, feedFor, limit, oauth = null, drafts = null }) {
  // inspectKey returns { user, keyId, perms }; without it every key is read-only.
  const who = async key => { if (inspectKey) return inspectKey(key); const user = await verifyKey(key); return user ? { user, keyId: null, perms: { read: true, drafts: false, send: false } } : null; };
  const head = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (res, status, body, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...head, ...extra }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const originOf = (req, url) => {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket?.encrypted ? 'https' : 'http');
    return `${proto}://${String(req.headers['x-forwarded-host'] || req.headers.host || url.host).split(',')[0]}`;
  };
  const prmPath = '/.well-known/oauth-protected-resource';
  const asMeta = base => ({
    issuer: base, authorization_endpoint: `${base}/api/ai/v1/oauth/authorize`, token_endpoint: `${base}/api/ai/v1/oauth/token`,
    registration_endpoint: `${base}/api/ai/v1/oauth/register`, response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mail.read', 'mail.draft', 'mail.send'],
  });
  const resolveUser = async bearer => {
    if (/^lbx_/.test(bearer)) return who(bearer);
    if (!oauth) return null;
    const t = (await oauth.get()).tokens[sha(bearer)];
    if (!t || t.kind !== 'access' || t.exp < Date.now()) return null;
    return who(t.key); // key deleted -> null; permissions are re-read from the key on every call
  };

  return async (req, res, url) => {
    const p = url.pathname;
    const base = originOf(req, url);
    // Discovery (RFC 9728 / RFC 8414), at root and path-suffixed variants clients try.
    if (oauth && req.method === 'GET' && (p === prmPath || p === `${prmPath}/api/ai/v1/mcp` || p === '/api/ai/v1/oauth/protected-resource')) {
      json(res, 200, { resource: `${base}/api/ai/v1/mcp`, authorization_servers: [base], scopes_supported: ['mail.read', 'mail.draft', 'mail.send'], bearer_methods_supported: ['header'], resource_name: 'Lockbox' }); return true;
    }
    if (oauth && req.method === 'GET' && ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/api/ai/v1/oauth/metadata'].includes(p)) { json(res, 200, asMeta(base)); return true; }

    if (p === '/api/ai/v1/mcp') {
      if (req.method === 'OPTIONS') { res.writeHead(204, head).end(); return true; }
      if (req.method !== 'POST') { json(res, 405, { error: 'use_post' }, { Allow: 'POST' }); return true; }
      // Browser pages on other sites may not call this endpoint.
      const origin = req.headers.origin;
      if (origin && origin !== base) { json(res, 403, { error: 'origin_not_allowed' }); return true; }
      const challenge = oauth ? { 'WWW-Authenticate': `Bearer resource_metadata="${base}/api/ai/v1/oauth/protected-resource"` } : {};
      const bearer = (/^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '') || [])[1];
      if (!bearer) { json(res, 401, { error: 'api_key_required' }, challenge); return true; }
      if (!limit('k:' + bearer.slice(-12))) { json(res, 429, { error: 'rate_limited' }); return true; }
      const caller = await resolveUser(bearer);
      const user = caller?.user;
      if (!user) { json(res, 401, { error: 'invalid_token' }, { 'WWW-Authenticate': challenge['WWW-Authenticate'] ? `${challenge['WWW-Authenticate']}, error="invalid_token"` : 'Bearer error="invalid_token"' }); return true; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return true; }
      const batch = Array.isArray(body) ? body.slice(0, 20) : [body];
      const out = (await Promise.all(batch.map(m => handleMcpMessage(m, { user, perms: caller.perms, keyId: caller.keyId, feedFor: async (u, o) => (await feedFor(u, o)).filter(x => can(caller.perms, x.mailbox, 'read')), drafts, base })))).filter(Boolean);
      if (!out.length) { res.writeHead(202, head).end(); return true; }
      json(res, 200, Array.isArray(body) ? out : out[0]); return true;
    }

    if (!oauth || !p.startsWith('/api/ai/v1/oauth/')) return false;
    if (p === '/api/ai/v1/oauth/register' && req.method === 'POST') {
      let b; try { b = parseForm(await readBody(req), 'json'); } catch { json(res, 400, { error: 'invalid_client_metadata' }); return true; }
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.slice(0, 10).map(String) : [];
      if (!uris.length || !uris.every(validRedirect)) { json(res, 400, { error: 'invalid_redirect_uri' }); return true; }
      const client_id = 'lbxc_' + randomBytes(12).toString('base64url');
      const client_name = String(b.client_name || 'AI app').slice(0, 80);
      await oauth.mutate(d => { d.clients[client_id] = { redirect_uris: uris, client_name, at: Date.now() }; if (Object.keys(d.clients).length > 500) delete d.clients[Object.keys(d.clients)[0]]; });
      json(res, 201, { client_id, client_name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }); return true;
    }
    if (p === '/api/ai/v1/oauth/authorize') {
      const q = req.method === 'POST' ? parseForm(await readBody(req), req.headers['content-type']) : Object.fromEntries(url.searchParams);
      const client = (await oauth.get()).clients[q.client_id];
      // Never redirect to an unregistered address.
      if (!client || !client.redirect_uris.includes(q.redirect_uri)) { json(res, 400, { error: 'invalid_client_or_redirect_uri' }); return true; }
      const back = params => { const u = new URL(q.redirect_uri); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v); res.writeHead(302, { ...head, Location: u.toString() }).end(); };
      if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge || '')) { back({ error: 'invalid_request', error_description: 'PKCE S256 required', state: q.state }); return true; }
      const page = (status, error) => { res.writeHead(status, { ...head, 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" }); res.end(authorizePage({ ...q, client_name: client.client_name }, error)); };
      if (req.method === 'GET') { page(200); return true; }
      if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      if (!limit('auth:' + (req.socket?.remoteAddress || ''))) { page(429, 'Too many attempts. Wait a minute.'); return true; }
      const key = String(q.api_key || '').trim();
      if (!(await verifyKey(key))) { page(401, 'That key is not valid. Copy a key from AI Access in Lockbox.'); return true; }
      const code = rand();
      await oauth.mutate(d => { d.tokens[sha(code)] = { kind: 'code', key, client_id: q.client_id, redirect_uri: q.redirect_uri, challenge: q.code_challenge, exp: Date.now() + CODE_TTL }; });
      back({ code, state: q.state }); return true;
    }
    if (p === '/api/ai/v1/oauth/token' && req.method === 'POST') {
      let b; try { b = parseForm(await readBody(req), req.headers['content-type']); } catch { json(res, 400, { error: 'invalid_request' }); return true; }
      const issue = (d, key, client_id) => {
        const access = rand(), refresh = rand(), now = Date.now();
        d.tokens[sha(access)] = { kind: 'access', key, client_id, exp: now + ACCESS_TTL };
        d.tokens[sha(refresh)] = { kind: 'refresh', key, client_id, exp: now + REFRESH_TTL };
        return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: 'mail.read mail.draft mail.send' };
      };
      const out = await oauth.mutate(async d => {
        if (b.grant_type === 'authorization_code') {
          const h = sha(b.code || ''); const c = d.tokens[h]; delete d.tokens[h]; // single use
          if (!c || c.kind !== 'code' || c.exp < Date.now() || c.client_id !== b.client_id || c.redirect_uri !== b.redirect_uri) return null;
          const verifier = String(b.code_verifier || '');
          if (createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return null;
          return issue(d, c.key, c.client_id);
        }
        if (b.grant_type === 'refresh_token') {
          const h = sha(b.refresh_token || ''); const r = d.tokens[h];
          if (!r || r.kind !== 'refresh' || r.exp < Date.now() || (b.client_id && r.client_id !== b.client_id)) return null;
          delete d.tokens[h]; // rotate
          return issue(d, r.key, r.client_id);
        }
        return 'unsupported';
      });
      if (out === 'unsupported') { json(res, 400, { error: 'unsupported_grant_type' }); return true; }
      if (!out || !(await verifyKey(out ? (await oauth.get()).tokens[sha(out.access_token)]?.key : ''))) { json(res, 400, { error: 'invalid_grant' }); return true; }
      json(res, 200, out); return true;
    }
    json(res, 404, { error: 'not_found' }); return true;
  };
}
