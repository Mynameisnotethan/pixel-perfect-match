// Per-key AI permissions, shared by the server, desktop app and the AI Access screen.
// Shape: { mailboxes: 'all' | { [mailboxId]: { read, drafts, send } }, read, drafts, send }
// The top-level flags are summaries: with 'all' they apply to every mailbox (also ones added later);
// with a list they say whether ANY listed mailbox allows it (used to decide which tools appear).
// Missing = read-only on all mailboxes. Sending only ever happens from a draft.
// autoSend: mailbox ids where the owner lets this key send/schedule without a per-email approval.
// Off unless listed explicitly, and only effective where the key also has Send email.
const flags = p => ({ read: p?.read !== false, drafts: p?.drafts === true, send: p?.send === true && p?.drafts === true });
export const READ_ONLY = Object.freeze({ mailboxes: 'all', read: true, drafts: false, send: false });
export function normalizePerms(p) {
  const m = p?.mailboxes;
  const autoSend = [...new Set((Array.isArray(p?.autoSend) ? p.autoSend : []).filter(id => typeof id === 'string' && id && id.length <= 300))].slice(0, 200);
  if (!m || m === 'all' || typeof m !== 'object' || Array.isArray(m)) { const f = flags(p); return { mailboxes: 'all', ...f, autoSend: f.send ? autoSend : [] }; }
  const boxes = {};
  for (const [id, v] of Object.entries(m).slice(0, 200)) {
    if (typeof id !== 'string' || !id || id.length > 300 || !v || typeof v !== 'object') continue;
    const f = { read: v.read === true, drafts: v.drafts === true, send: v.send === true && v.drafts === true };
    if (f.read || f.drafts) boxes[id] = f;
  }
  const any = k => Object.values(boxes).some(b => b[k]);
  return { mailboxes: boxes, read: any('read'), drafts: any('drafts'), send: any('send'), autoSend: autoSend.filter(id => boxes[id]?.send) };
}
/** What a key may do in one mailbox. */
export function boxPerms(perms, mailboxId) {
  const p = normalizePerms(perms);
  if (p.mailboxes === 'all') return { read: p.read, drafts: p.drafts, send: p.send };
  return p.mailboxes[mailboxId] || { read: false, drafts: false, send: false };
}
export const can = (perms, mailboxId, what) => boxPerms(perms, mailboxId)[what] === true;
/** True when the owner turned on "Allow sending without per-email approval" for this key and mailbox. */
export const canAutoSend = (perms, mailboxId) => !!perms && can(perms, mailboxId, 'send') && normalizePerms(perms).autoSend.includes(mailboxId);
/** Drop mailboxes that no longer exist (keeps 'all' untouched). */
export const keepKnown = (perms, ids) => { const p = normalizePerms(perms); if (p.mailboxes === 'all' || !ids) return p; return normalizePerms({ mailboxes: Object.fromEntries(Object.entries(p.mailboxes).filter(([id]) => ids.includes(id))), autoSend: p.autoSend }); };
