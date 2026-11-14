// Per-key AI permissions, shared by the server, desktop app and the AI Access screen.
// Shape: { mailboxes: 'all' | { [mailboxId]: { read, drafts, send } }, read, drafts, send }
// The top-level flags are summaries: with 'all' they apply to every mailbox (also ones added later);
// with a list they say whether ANY listed mailbox allows it (used to decide which tools appear).
// Missing = read-only on all mailboxes. Sending only ever happens from a draft.
const flags = p => ({ read: p?.read !== false, drafts: p?.drafts === true, send: p?.send === true && p?.drafts === true });
export const READ_ONLY = Object.freeze({ mailboxes: 'all', read: true, drafts: false, send: false });
export function normalizePerms(p) {
  const m = p?.mailboxes;
  if (!m || m === 'all' || typeof m !== 'object' || Array.isArray(m)) return { mailboxes: 'all', ...flags(p) };
  const boxes = {};
  for (const [id, v] of Object.entries(m).slice(0, 200)) {
    if (typeof id !== 'string' || !id || id.length > 300 || !v || typeof v !== 'object') continue;
    const f = { read: v.read === true, drafts: v.drafts === true, send: v.send === true && v.drafts === true };
    if (f.read || f.drafts) boxes[id] = f;
  }
  const any = k => Object.values(boxes).some(b => b[k]);
  return { mailboxes: boxes, read: any('read'), drafts: any('drafts'), send: any('send') };
}
/** What a key may do in one mailbox. */
export function boxPerms(perms, mailboxId) {
  const p = normalizePerms(perms);
  if (p.mailboxes === 'all') return { read: p.read, drafts: p.drafts, send: p.send };
  return p.mailboxes[mailboxId] || { read: false, drafts: false, send: false };
}
export const can = (perms, mailboxId, what) => boxPerms(perms, mailboxId)[what] === true;
/** Drop mailboxes that no longer exist (keeps 'all' untouched). */
export const keepKnown = (perms, ids) => { const p = normalizePerms(perms); if (p.mailboxes === 'all' || !ids) return p; return normalizePerms({ mailboxes: Object.fromEntries(Object.entries(p.mailboxes).filter(([id]) => ids.includes(id))) }); };
