// The AI agent feed: an agent sends `Authorization: Bearer lbx_...` and gets the same redacted view as
// "What the AI sees". Redaction runs here from rules saved by the owner, never from what a caller sends.
// Shared by the Docker mail server and the desktop app.
import { aiView, normalizeDefaults } from './privacy-core.mjs';

/** Per-message fields that make up hide-from-AI rules (everything else comes fresh from the mailbox). */
export const RULE_KEYS = ['reviewed', 'overrides', 'hiddenSubjectRanges', 'hiddenSenderRanges', 'hiddenEmailRanges', 'hiddenToRanges', 'hiddenRanges', 'hiddenAttachments', 'hiddenAttachmentLabels'];
export function rulesFrom(messages = []) {
  const out = {};
  for (const m of messages) {
    const r = {}; for (const k of RULE_KEYS) if (m[k] !== undefined) r[k] = m[k];
    if (Object.keys(r).length) out[m.id] = r;
  }
  return out;
}
const pickRules = r => Object.fromEntries(RULE_KEYS.filter(k => r && r[k] !== undefined).map(k => [k, r[k]]));
/** Cleans a privacy document sent by the owner's screens before it is stored. */
export function cleanPrivacy(body = {}) {
  const rules = {};
  for (const [id, r] of Object.entries(body.rules || {}).slice(0, 20000)) if (typeof id === 'string' && id.length < 400 && r && typeof r === 'object') rules[id] = pickRules(r);
  const labels = Array.isArray(body.labels) ? body.labels.slice(0, 200).map(l => ({ id: String(l.id || ''), name: String(l.name || '').slice(0, 60), color: String(l.color || '') })) : undefined;
  return { rules, defaults: normalizeDefaults(body.defaults), ...(labels ? { labels } : {}) };
}

/** Splits "Name <a@b.c>" into its parts. */
export function parseFrom(from = '') {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { sender: m[1].trim() || m[2], email: m[2].trim() } : { sender: from.trim(), email: from.trim() };
}
/** Converts synced provider inbox items into Lockbox messages for one mailbox. */
export const inboxToMessages = (box, items) => items.map(item => {
  const { sender, email } = parseFrom(item.from);
  return { id: `${box.id}:${item.id}`, sender, email, subject: item.subject || '(no subject)', body: item.snippet || '', account: box.id, folder: 'inbox', read: !!item.read, flagged: false, date: item.date, attachments: [] };
});

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
export function createAiRoutes({ verifyKey, feedFor, limit = createLimiter() }) {
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/ai/v1/')) return false;
    if (req.method !== 'GET') { json(res, 405, { error: 'read_only' }); return true; }
    const key = (/^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '') || [])[1];
    if (!key || !limit('k:' + key.slice(-12))) { json(res, key ? 429 : 401, { error: key ? 'rate_limited' : 'api_key_required' }); return true; }
    const user = await verifyKey(key);
    if (!user) { json(res, 401, { error: 'invalid_api_key' }); return true; }
    const m = url.pathname.match(/^\/api\/ai\/v1\/messages(?:\/(.+))?$/);
    if (!m) { json(res, 404, { error: 'not_found' }); return true; }
    const feed = await feedFor(user, { mailbox: url.searchParams.get('mailbox') || undefined });
    if (m[1]) { const one = feed.find(x => x.id === decodeURIComponent(m[1])); json(res, one ? 200 : 404, one || { error: 'not_found' }); return true; }
    const n = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 100);
    json(res, 200, { messages: feed.slice(0, n) });
    return true;
  };
}
