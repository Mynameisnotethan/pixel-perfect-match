import { can, boxPerms, canAutoSend } from './ai-perms.mjs';
/** Build marker shown in MCP initialize, so the owner can tell which code a server runs. Bump when MCP behaviour changes. */
export const LOCKBOX_VERSION = '2026.11.15-all-mailbox-send';
// Native MCP (Model Context Protocol) endpoint for AI agents: POST /api/ai/v1/mcp.
// Stateless Streamable HTTP, JSON responses only. Two read-only tools over the same redacted feed
// as the REST API, so redaction and "reviewed only" rules are identical.
// Also a small OAuth 2.1 bridge (PKCE S256, dynamic client registration) for clients such as
// ChatGPT that only accept OAuth: the owner pastes an lbx_ key once on the authorize page and the
// client receives tokens tied to that key. Each token is re-checked against the key store on every
// call, so deleting the key cuts the client off immediately.
import { createHash, randomBytes } from 'node:crypto';
import { providerFailure } from './ai-drafts.mjs';

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
  {
    name: 'list_drafts', title: 'List email drafts',
    description: 'List drafts made with create_draft, newest first, with version, preview, where each is saved (storage_status, provider_draft_id), approval and schedule status.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      mailbox: { type: 'string', maxLength: 300, description: 'Only drafts from this mailbox id.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many drafts (default 25).' },
    } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_draft', title: 'Read email draft',
    description: 'Read one draft by draft_id: version, preview, storage status, provider draft id, approval, send and schedule status.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['draft_id'], properties: { draft_id: { type: 'string', maxLength: 100 } } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];
const DRAFT_REF = { draft_id: { type: 'string', maxLength: 100 }, version: { type: 'integer', minimum: 1, description: 'The version you showed the owner. Fails if the draft changed.' } };
export const APPROVAL_TOOLS = [
  {
    name: 'request_send_approval', title: 'Ask owner to approve',
    description: 'Ask the owner to review and approve the exact current version of a draft. Returns approval_url for the owner. Never sends anything, even when the draft is already approved.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['draft_id'], properties: DRAFT_REF },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'schedule_send', title: 'Schedule draft',
    description: 'Schedule a draft to be sent at send_at (ISO 8601 with a time zone, e.g. 2026-11-20T09:00:00-05:00). Pass version. If the owner allowed this key to send without per-email approval for this mailbox (direct_send true in get_draft), that exact version is queued immediately and status queued is returned, with no approval_url; otherwise the owner approves it via the returned approval_url. Lockbox sends it once at that time. Rescheduling or editing needs a new approval. Use get_draft for schedule_status.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['draft_id', 'send_at'], properties: { ...DRAFT_REF, send_at: { type: 'string', maxLength: 40 } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'cancel_scheduled_send', title: 'Cancel scheduled send',
    description: 'Cancel a scheduled send before it goes out. The draft stays and its approval is cleared.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['draft_id'], properties: { draft_id: { type: 'string', maxLength: 100 } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
export const SEND_TOOL = {
  name: 'send_draft', title: 'Send approved draft',
  description: 'Send the exact draft version passed in version. If the owner allowed this key to send without per-email approval for this mailbox, it is sent now; otherwise the owner must approve this exact version in Lockbox. If not approved yet, returns status approval_required and an approval_url for the owner; nothing is sent. Safe to call again: an approved version is sent at most once.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['draft_id'], properties: {
    draft_id: { type: 'string', maxLength: 100 }, version: { type: 'integer', minimum: 1, description: 'The version shown to the owner. Send fails if the draft changed.' },
  } },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};
/** Always available, read-only: which key this connection uses and what it may do. No secrets, no email content. */
export const ACCESS_TOOL = {
  name: 'get_access', title: 'Check my access',
  description: 'Show which Lockbox key this connection uses (name and last 4 characters), the server build, and for each mailbox whether this key can see emails, draft, send, and send without per-email approval (direct_send). Read-only; never shows secrets or email content.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};
/** Tools this key may use. */
export const toolsFor = (perms = {}, drafts = null) => [
  ...(perms.read !== false ? MCP_TOOLS : []),
  ...(drafts && perms.drafts ? DRAFT_TOOLS : []),
  ...(drafts && perms.send ? [SEND_TOOL, ...APPROVAL_TOOLS] : []),
  ACCESS_TOOL,
];
/** What get_access reports. mailboxes: the owner's connected mailboxes [{ id, email, provider, caps }]. */
export function accessReport({ perms, access = {}, mailboxes = [] }) {
  const ids = [...new Set([...mailboxes.map(b => b.id), ...(perms?.mailboxes && perms.mailboxes !== 'all' ? Object.keys(perms.mailboxes) : [])])];
  return {
    build: LOCKBOX_VERSION,
    key: access.keyName ? { name: access.keyName, last4: access.last4 || '' } : null,
    connected_via: access.via || 'api_key', ...(access.client ? { client: access.client } : {}),
    all_mailboxes: perms?.mailboxes === 'all',
    mailboxes: ids.map(id => {
      const b = mailboxes.find(x => String(x.id).toLowerCase() === String(id).toLowerCase());
      const f = boxPerms(perms, id);
      return { mailbox: id, email: b?.email || null, connected: !!b, see: !!f.read, draft: !!f.drafts, send: !!f.send, direct_send: canAutoSend(perms, id),
        ...(b && b.provider !== 'imap' ? { mailbox_allows_drafts: !!b.caps?.drafts, mailbox_allows_send: !!b.caps?.send } : {}) };
    }),
  };
}
const INSTRUCTIONS = 'Access to the owner\'s Lockbox mailbox, limited by what their API key allows. Only emails the owner reviewed are shared. Text shown as [hidden: Label] was hidden by the owner: never guess or ask for it. Some keys may also create and edit drafts; sending needs the owner to approve the exact email in Lockbox unless they allowed this key to send without per-email approval for that mailbox. Creating or editing a draft never sends it. Never claim an email was sent unless send_draft returned status sent.';

/** Pure JSON-RPC handling for one MCP message. Returns a response object, or null for notifications. */
export async function handleMcpMessage(msg, { user, feedFor, perms = { read: true }, keyId = null, drafts = null, base = '', access = {}, mailboxesFor = null }) {
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (msg.id === undefined) return null; // notification (e.g. notifications/initialized)
  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize': return ok({
      protocolVersion: SUPPORTED.includes(p.protocolVersion) ? p.protocolVersion : MCP_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'lockbox', title: 'Lockbox', version: LOCKBOX_VERSION },
      instructions: INSTRUCTIONS,
    });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: toolsFor(perms, drafts) });
    case 'tools/call': {
      const a = p.arguments || {};
      const toolErr = text => ok({ content: [{ type: 'text', text }], isError: true });
      if (typeof a !== 'object' || Array.isArray(a)) return toolErr('Arguments must be an object.');
      const allowed = toolsFor(perms, drafts).map(t => t.name);
      if (p.name === 'get_access') {
        if (Object.keys(a).length) return toolErr(`Unknown argument: ${Object.keys(a)[0]}`);
        let mailboxes = []; try { mailboxes = mailboxesFor ? await mailboxesFor(user) : []; } catch { mailboxes = []; }
        const r = accessReport({ perms, access, mailboxes });
        return ok({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r });
      }
      if ([...MCP_TOOLS, ...DRAFT_TOOLS, SEND_TOOL, ...APPROVAL_TOOLS].some(t => t.name === p.name) && !allowed.includes(p.name)) return toolErr('This API key is not allowed to use that tool. The owner can change key permissions in Lockbox → AI Access.');
      const draftCall = async (fn, keys) => {
        const extra = Object.keys(a).filter(k => !keys.includes(k));
        if (extra.length) return toolErr(`Unknown argument: ${extra[0]}`);
        try {
          const r = await fn();
          // One line per send decision so the owner can see in the server log what happened. No content, no secrets.
          if (['send_draft', 'schedule_send'].includes(p.name)) console.log(`[lockbox] mcp ${p.name} req_${randomBytes(6).toString('hex')} key=…${access.last4 || '?'} via=${access.via || 'api_key'} mailbox=${r?.mailbox || ''} draft=${r?.draft_id || ''} v${r?.version || ''} status=${r?.status || ''} direct_send=${r?.direct_send === true}${r?.approval_reason ? ` reason=${r.approval_reason}` : ''}`);
          return ok({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r });
        }
        catch (e) {
          // Sanitized, actionable error with a request id the owner can find in the server log.
          const request_id = 'req_' + randomBytes(6).toString('hex');
          const code = e.code || (e.message === 'reconnect_required' ? 'mailbox_authorization_expired' : e.providerStatus ? 'provider_error' : e.status === 404 ? 'not_found' : e.status && e.status < 500 ? 'validation_error' : 'server_error');
          const message = code === 'mailbox_authorization_expired' || code === 'provider_error' ? providerFailure(e, { mailbox: a.mailbox || '' })
            : code === 'server_error' ? 'Lockbox could not finish this request.' : e.detail || e.message;
          console.error(`[lockbox] mcp ${p.name} ${request_id} code=${code} status=${e.status || ''} provider=${e.providerStatus || ''} ${e.providerCode || ''}`);
          const error = { code, message, request_id };
          return ok({ content: [{ type: 'text', text: `${message} [${code}, request ${request_id}]` }], structuredContent: { error }, isError: true });
        }
      };
      const who = { user, keyId, perms, keyName: access.keyName, last4: access.last4 };
      if (p.name === 'create_draft') return draftCall(() => drafts.create(who, a), ['mailbox', 'reply_to_message_id', 'reply_all', 'to', 'cc', 'bcc', 'subject', 'body']);
      if (p.name === 'update_draft') return draftCall(() => drafts.update(who, a), ['draft_id', 'mailbox', 'to', 'cc', 'bcc', 'subject', 'body']);
      const approvalUrl = id => `${base}/api/ai/approve/${encodeURIComponent(id)}`;
      if (p.name === 'list_drafts') return draftCall(() => drafts.list(who, a), ['mailbox', 'limit']);
      if (p.name === 'get_draft') return draftCall(() => drafts.get(who, a), ['draft_id']);
      if (p.name === 'request_send_approval') return draftCall(() => drafts.requestApproval(who, a, { approvalUrl }), ['draft_id', 'version']);
      if (p.name === 'schedule_send') return draftCall(() => drafts.schedule(who, a, { approvalUrl }), ['draft_id', 'version', 'send_at']);
      if (p.name === 'cancel_scheduled_send') return draftCall(() => drafts.cancelSchedule(who, a), ['draft_id']);
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
  // Last use per app since the server started (kept in memory so a call never rewrites the file).
  return { mutate, get: async () => load(), used: new Map() };
}

/**
 * Apps (e.g. ChatGPT) connected through app sign-in, grouped by the key they were given.
 * identify(lbxKey) -> { user, keyId } | null. Only this owner's apps are returned.
 */
export async function listConnectedApps(oauth, identify, user) {
  if (!oauth) return [];
  const d = await oauth.get(); const apps = new Map(); const known = new Map();
  for (const t of Object.values(d.tokens)) {
    if ((t.kind !== 'refresh' && t.kind !== 'access') || t.exp < Date.now()) continue;
    if (!known.has(t.key)) known.set(t.key, await identify(t.key));
    const k = known.get(t.key); if (!k || k.user !== user) continue;
    const id = `${k.keyId}:${t.client_id}`;
    const prev = apps.get(id);
    apps.set(id, { keyId: k.keyId, clientId: t.client_id, name: d.clients[t.client_id]?.client_name || 'AI app', connectedAt: new Date(Math.min(prev ? Date.parse(prev.connectedAt) : Infinity, t.at || d.clients[t.client_id]?.at || Date.now())).toISOString(), lastUsedAt: oauth.used?.get(t.client_id) || prev?.lastUsedAt || null });
  }
  return [...apps.values()];
}
/** Signs one app out of one of this owner's keys: deletes its tokens. The key itself keeps working. */
export async function disconnectApp(oauth, identify, user, keyId, clientId) {
  if (!oauth) return 0;
  const d = await oauth.get(); const drop = [];
  for (const [h, t] of Object.entries(d.tokens)) { if (t.client_id !== clientId) continue; const k = await identify(t.key); if (k && k.user === user && k.keyId === keyId) drop.push(h); }
  if (drop.length) await oauth.mutate(db => { for (const h of drop) delete db.tokens[h]; });
  return drop.length;
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
export function createMcpRoutes({ verifyKey, inspectKey = null, feedFor, limit, oauth = null, drafts = null, mailboxesFor = null }) {
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
    if (/^lbx_/.test(bearer)) { const c = await who(bearer); return c && { ...c, via: 'api_key' }; }
    if (!oauth) return null;
    const d = await oauth.get(); const t = d.tokens[sha(bearer)];
    if (!t || t.kind !== 'access' || t.exp < Date.now()) return null;
    const c = await who(t.key); // key deleted -> null; permissions are re-read from the key on every call
    if (c) oauth.used?.set(t.client_id, new Date().toISOString());
    return c && { ...c, via: 'app_sign_in', client: d.clients[t.client_id]?.client_name || 'AI app' };
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
      const out = (await Promise.all(batch.map(m => handleMcpMessage(m, { user, perms: caller.perms, keyId: caller.keyId, access: { keyName: caller.keyName, last4: caller.last4, via: caller.via, client: caller.client }, mailboxesFor, feedFor: async (u, o) => (await feedFor(u, o)).filter(x => can(caller.perms, x.mailbox, 'read')), drafts, base })))).filter(Boolean);
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
        d.tokens[sha(access)] = { kind: 'access', key, client_id, exp: now + ACCESS_TTL, at: now };
        d.tokens[sha(refresh)] = { kind: 'refresh', key, client_id, exp: now + REFRESH_TTL, at: now };
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
