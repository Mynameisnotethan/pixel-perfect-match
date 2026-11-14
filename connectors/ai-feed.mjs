import { can } from './ai-perms.mjs';
import { aiOpenApi } from './ai-openapi.mjs';
import { createMcpRoutes } from './ai-mcp.mjs';
// The AI agent feed: an agent sends `Authorization: Bearer lbx_...` and gets the same redacted view as
// "What the AI sees". Redaction runs here from rules saved by the owner, never from what a caller sends.
// Shared by the Docker mail server and the desktop app.
import { aiView, normalizeDefaults } from './privacy-core.mjs';

import { RULE_KEYS, rulesFrom, pickRules, cleanPrivacy, parseFrom, inboxToMessages } from './feed-core.mjs';
export { RULE_KEYS, rulesFrom, pickRules, cleanPrivacy, parseFrom, inboxToMessages };

/**
 * Builds the redacted feed. Without saved rules nothing is returned, because every email counts as
 * not reviewed (grey) until its owner opens it in Lockbox.
 */
export async function buildFeed({ boxes, fetchInbox, privacy, mailbox }) {
  const p = privacy || { rules: {} };
  const out = [];
  for (const box of boxes) {
    if (mailbox && box.id !== mailbox) continue;
    if (box.status === 'reconnect') continue;
    let items; try { items = await fetchInbox(box); } catch { continue; }
    for (const m of inboxToMessages(box, items)) {
      const v = aiView({ ...m, ...pickRules(p.rules?.[m.id]) }, normalizeDefaults(p.defaults), p.labels);
      if (v) out.push({ ...v, mailbox: box.id });
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Simple fixed-window limiter: `max` requests per minute per key. */
export function createLimiter(max = 60, windowMs = 60_000) {
  const hits = new Map();
  return id => { const now = Date.now(); const h = hits.get(id); if (!h || now - h.at > windowMs) { hits.set(id, { at: now, n: 1 }); return true; } return ++h.n <= max; };
}

/**
 * Handles GET /api/ai/v1/messages and /api/ai/v1/messages/:id. Returns false for other paths.
 * feedFor(user, { mailbox }) must return buildFeed() output for that user only.
 */
export function createAiRoutes({ verifyKey, inspectKey = null, feedFor, limit = createLimiter(), oauth = null, drafts = null }) {
  const mcp = createMcpRoutes({ verifyKey, inspectKey, feedFor, limit, oauth, drafts });
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  return async (req, res, url) => {
    if (await mcp(req, res, url)) return true;
    if (!url.pathname.startsWith('/api/ai/v1/')) return false;
    if (url.pathname === '/api/ai/v1/openapi.json' && req.method === 'GET') {
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket?.encrypted ? 'https' : 'http');
      json(res, 200, aiOpenApi(`${proto}://${req.headers['x-forwarded-host'] || req.headers.host || url.host}/api/ai/v1`)); return true;
    }
    if (req.method !== 'GET') { json(res, 405, { error: 'read_only' }); return true; }
    const key = (/^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '') || [])[1];
    if (!key || !limit('k:' + key.slice(-12))) { json(res, key ? 429 : 401, { error: key ? 'rate_limited' : 'api_key_required' }); return true; }
    let caller;
    if (inspectKey) caller = await inspectKey(key);
    else { const u = await verifyKey(key); caller = u ? { user: u, perms: { read: true } } : null; }
    const user = caller?.user;
    if (!user) { json(res, 401, { error: 'invalid_api_key' }); return true; }
    if (caller.perms?.read === false) { json(res, 403, { error: 'read_not_allowed' }); return true; }
    const m = url.pathname.match(/^\/api\/ai\/v1\/messages(?:\/(.+))?$/);
    if (!m) { json(res, 404, { error: 'not_found' }); return true; }
    const feed = (await feedFor(user, { mailbox: url.searchParams.get('mailbox') || undefined })).filter(x => can(caller.perms, x.mailbox, 'read'));
    if (m[1]) { const one = feed.find(x => x.id === decodeURIComponent(m[1])); json(res, one ? 200 : 404, one || { error: 'not_found' }); return true; }
    const n = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 100);
    json(res, 200, { messages: feed.slice(0, n) });
    return true;
  };
}
