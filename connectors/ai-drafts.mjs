// AI drafts: an agent with a "Manage drafts" key can create and edit drafts in the owner's Gmail or
// Outlook mailbox; with "Send email" it can ask to send one. Sending always needs the owner's approval of
// that exact version, given in Lockbox itself (signed-in approval page, or a native dialog on desktop).
// A tool argument can never approve. Each approved version is sent at most once.
// Shared by the Docker mail server and the desktop app.
import { createHash, randomBytes } from 'node:crypto';
import { normalizeOutgoing } from './outgoing.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const emailOf = v => { const m = /<([^>]+)>/.exec(String(v || '')); return (m ? m[1] : String(v || '')).trim(); };
const splitList = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => emailOf(x)).filter(Boolean);
const uniq = list => { const seen = new Set(); return list.filter(a => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
const MAX_DRAFTS = 300;
export const ORIGINAL_RECIPIENT = '[recipient from original email]';

/** The exact addressed content of a draft. Its hash is what an approval covers. */
export function effective(d) {
  return {
    mailbox: d.mailbox, from: d.from,
    to: uniq([...(d.baseTo || []), ...(d.to || [])]).join(', '),
    cc: uniq([...(d.baseCc || []), ...(d.cc || [])]).join(', '),
    bcc: uniq(d.bcc || []).join(', '),
    subject: d.subject, body: d.body,
    inReplyTo: d.reply?.inReplyTo || '',
  };
}
export const contentHash = d => sha(JSON.stringify(effective(d)));

/** What the agent is shown: never reveals parts of the original email the owner hid. */
function aiPreview(d) {
  const e = effective(d);
  const show = list => list ? list.split(', ').map(a => d.mask?.addrs?.[a.toLowerCase()] || a).join(', ') : '';
  return {
    draft_id: d.id, version: d.version, mailbox: d.mailbox, from: d.from,
    to: show(e.to), cc: show(e.cc), bcc: e.bcc, subject: d.mask?.subject || e.subject, body: e.body,
    reply_to_message_id: d.reply?.feedId || null,
    status: d.send?.status === 'sent' && d.send.hash === d.hash ? 'sent' : d.send?.status === 'unknown' ? 'send_status_unknown' : 'draft',
    approved_for_sending: !!d.approval && d.approval.hash === d.hash,
  };
}
/** What the owner is shown on the approval page: the real, complete content. */
export const ownerPreview = d => ({ id: d.id, version: d.version, hash: d.hash, ...effective(d), approved: !!d.approval && d.approval.hash === d.hash, sent: d.send?.status === 'sent' && d.send.hash === d.hash, status: d.send?.status || 'draft' });

const pickText = (v, name, max) => { if (v === undefined) return undefined; if (typeof v !== 'string' || v.length > max) throw err(`${name} must be text (max ${max} characters).`); return v; };
const pickList = (v, name) => { if (v === undefined) return undefined; if (!(typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string')))) throw err(`${name} must be a list of addresses.`); return splitList(v); };
// Ambiguous = the provider may have sent it (network failure, timeout, 5xx). Clear 4xx answers mean it did not.
const ambiguous = e => !(e.status === 409 || (e.providerStatus >= 400 && e.providerStatus < 500 && ![408, 429].includes(e.providerStatus)));

/**
 * read()/write(db) persist { drafts: { [id]: draft } } (encrypted by the caller).
 * withMailbox(owner, mailboxId, fn(api, box)) runs fn with provider draft operations for a mailbox the owner
 *   owns (it must throw otherwise); box has { id, email, provider, caps: { drafts, send } }.
 * feedFor(owner, opts) returns the owner's reviewed, redacted feed (replies may only target these).
 * confirm(ownerPreview) optional trusted native confirmation (desktop). Resolves true when the owner approves.
 */
export function createDraftService({ read, write, withMailbox, feedFor, confirm = null }) {
  let queue = Promise.resolve();
  const mutate = fn => { const run = queue.then(async () => { const db = { drafts: {}, ...((await read()) || {}) }; const out = await fn(db); await write(db); return out; }); queue = run.catch(() => {}); return run; };
  const own = (db, who, id) => { const d = typeof id === 'string' && db.drafts[id]; if (!d || d.owner !== who.user) throw err('Draft not found.', 404); return d; };
  const needCaps = (box, need) => {
    if (!['google', 'microsoft'].includes(box.provider)) throw err('AI drafts work with Gmail and Outlook mailboxes only.');
    if (!box.caps?.[need]) throw err(`This mailbox has not allowed Lockbox to ${need === 'send' ? 'send' : 'save drafts'} for AI yet. In Lockbox, open Mailboxes and click "Allow AI drafts" on ${box.email}, then try again. Reading still works meanwhile.`, 409);
  };
  const validate = d => { const e = effective(d); normalizeOutgoing({ to: e.to, cc: e.cc, bcc: e.bcc, subject: e.subject, body: e.body }); };

  async function create(who, a = {}) {
    const to = pickList(a.to, 'to') || [], cc = pickList(a.cc, 'cc') || [], bcc = pickList(a.bcc, 'bcc') || [];
    let subject = pickText(a.subject, 'subject', 998); const body = pickText(a.body, 'body', 200_000) ?? '';
    const d = { id: 'drf_' + randomBytes(12).toString('base64url'), owner: who.user, keyId: who.keyId || null, version: 1, to, cc, bcc, body, baseTo: [], baseCc: [], mask: { addrs: {} }, createdAt: new Date().toISOString() };
    let mailbox = pickText(a.mailbox, 'mailbox', 300);
    if (a.reply_to_message_id !== undefined) {
      const fid = pickText(a.reply_to_message_id, 'reply_to_message_id', 400);
      const orig = (await feedFor(who.user, {})).find(m => m.id === fid);
      if (!orig) throw err('You can only reply to an email the owner has reviewed.', 404);
      if (mailbox && mailbox !== orig.mailbox) throw err('A reply is sent from the mailbox that received the email.');
      mailbox = orig.mailbox; d.reply = { feedId: fid };
      d._orig = orig;
    }
    if (!mailbox) throw err('mailbox is required (for example google:me@gmail.com). list_messages shows mailbox ids.');
    d.mailbox = mailbox;
    return withMailbox(who.user, mailbox, async (api, box) => {
      needCaps(box, 'drafts'); d.from = box.email;
      if (d.reply) {
        const orig = d._orig; delete d._orig;
        const ctx = await api.replyContext(String(orig.id).slice(box.id.length + 1));
        Object.assign(d.reply, { threadId: ctx.threadId || '', inReplyTo: ctx.inReplyTo || '', references: ctx.references || '', ...(ctx.graphId ? { graphId: ctx.graphId } : {}) });
        const self = box.email.toLowerCase();
        const sender = emailOf(ctx.replyTo?.split(',')[0] || ctx.from);
        d.baseTo = sender ? [sender] : [];
        if (sender) d.mask.addrs[sender.toLowerCase()] = /\[hidden/.test(orig.email || '') ? orig.email : sender;
        if (a.reply_all === true) {
          const others = uniq([...splitList(ctx.to), ...splitList(ctx.cc)]).filter(x => ![self, sender.toLowerCase()].includes(x.toLowerCase()));
          d.baseCc = others; for (const o of others) d.mask.addrs[o.toLowerCase()] = ORIGINAL_RECIPIENT;
        }
        if (subject === undefined) {
          subject = /^re:/i.test(ctx.subject || '') ? ctx.subject : `Re: ${ctx.subject || ''}`.trim();
          if (/\[hidden/.test(orig.subject || '')) d.mask.subject = `Re: ${orig.subject}`;
        }
      }
      d.subject = subject ?? ''; d.reply_all = a.reply_all === true;
      validate(d); d.hash = contentHash(d);
      const { providerDraftId } = await api.createDraft(box.email, d);
      d.providerDraftId = providerDraftId; d.updatedAt = d.createdAt;
      await mutate(db => {
        db.drafts[d.id] = d;
        const ids = Object.keys(db.drafts); if (ids.length > MAX_DRAFTS) for (const id of ids.slice(0, ids.length - MAX_DRAFTS)) delete db.drafts[id];
      });
      return aiPreview(d);
    });
  }

  async function update(who, a = {}) {
    const current = await mutate(db => structuredClone(own(db, who, a.draft_id)));
    if (current.send?.status === 'sent') throw err('This draft was already sent. Create a new draft instead.');
    if (current.send?.status === 'sending' || current.send?.status === 'unknown') throw err('This draft may have been sent. Call send_draft to check its status before editing.', 409);
    const next = structuredClone(current);
    for (const k of ['to', 'cc', 'bcc']) { const v = pickList(a[k], k); if (v !== undefined) next[k] = v; }
    const subject = pickText(a.subject, 'subject', 998); if (subject !== undefined) { next.subject = subject; delete next.mask.subject; }
    const body = pickText(a.body, 'body', 200_000); if (body !== undefined) next.body = body;
    const mailbox = pickText(a.mailbox, 'mailbox', 300);
    if (mailbox !== undefined && mailbox !== current.mailbox && current.reply) throw err('A reply stays in the mailbox that received the email.');
    validate(next);
    const hash = contentHash({ ...next, mailbox: mailbox || next.mailbox });
    if (mailbox && mailbox !== current.mailbox) {
      // Moving to another of the owner's mailboxes: create there first, then remove the old draft.
      const made = await withMailbox(who.user, mailbox, async (api, box) => { needCaps(box, 'drafts'); const n = { ...next, mailbox, from: box.email }; return { ...(await api.createDraft(box.email, n)), from: box.email }; });
      await withMailbox(who.user, current.mailbox, api => api.deleteDraft(current.providerDraftId)).catch(() => {});
      Object.assign(next, { mailbox, from: made.from, providerDraftId: made.providerDraftId });
    } else if (hash !== current.hash) {
      await withMailbox(who.user, current.mailbox, async (api, box) => { needCaps(box, 'drafts'); await api.updateDraft(box.email, current.providerDraftId, next); });
    }
    return mutate(db => {
      const d = own(db, who, a.draft_id);
      if (d.version !== current.version) throw err('The draft changed while you were editing it. Try again.', 409);
      if (contentHash(next) !== d.hash) { Object.assign(d, next, { version: d.version + 1, hash: contentHash(next), approval: null, updatedAt: new Date().toISOString() }); }
      return aiPreview(d);
    });
  }

  async function send(who, a = {}, { approvalUrl = id => `/api/ai/approve/${id}` } = {}) {
    let d = await mutate(db => structuredClone(own(db, who, a.draft_id)));
    if (a.version !== undefined && a.version !== d.version) throw err(`The draft is now version ${d.version}. Check the preview and ask the owner to approve that version.`, 409);
    // Reconcile an earlier attempt whose result was unclear before doing anything else.
    if (d.send && d.send.hash === d.hash && ['sending', 'unknown'].includes(d.send.status)) {
      let stillThere;
      try { stillThere = await withMailbox(who.user, d.mailbox, api => api.draftExists(d.providerDraftId)); }
      catch { return { ...aiPreview({ ...d, send: { ...d.send, status: 'unknown' } }), status: 'send_status_unknown', message: 'Could not confirm whether the earlier send went out. Nothing was resent. Try send_draft again later.' }; }
      d = await mutate(db => { const x = own(db, who, a.draft_id); x.send = stillThere ? null : { ...x.send, status: 'sent', at: new Date().toISOString() }; return structuredClone(x); });
    }
    if (d.send?.status === 'sent' && d.send.hash === d.hash) return { ...aiPreview(d), status: 'sent', provider_message_id: d.send.messageId || null, message: 'Already sent. It was not sent again.' };
    if (!d.approval || d.approval.hash !== d.hash) {
      let approved = false;
      if (confirm) { try { approved = await confirm(ownerPreview(d)); } catch { approved = false; } }
      if (approved) await approve(who.user, d.id, d.hash);
      else return { ...aiPreview(d), status: 'approval_required', approval_url: approvalUrl(d.id), message: confirm ? 'The owner did not approve this version in Lockbox. Nothing was sent.' : 'Nothing was sent. Ask the owner to open approval_url, check the exact email and approve it, then call send_draft again.' };
    }
    // Claim this version for sending inside the queue, so parallel calls cannot both send.
    const claim = await mutate(db => {
      const x = own(db, who, a.draft_id);
      if (!x.approval || x.approval.hash !== x.hash) return { stop: 'approval_required', d: structuredClone(x) };
      if (x.send && x.send.hash === x.hash) return { stop: x.send.status, d: structuredClone(x) };
      x.send = { hash: x.hash, status: 'sending', at: new Date().toISOString() }; return { d: structuredClone(x) };
    });
    if (claim.stop === 'approval_required') return { ...aiPreview(claim.d), status: 'approval_required', approval_url: approvalUrl(claim.d.id) };
    if (claim.stop) return { ...aiPreview(claim.d), status: claim.stop === 'sent' ? 'sent' : claim.stop === 'sending' ? 'sending' : 'send_status_unknown', provider_message_id: claim.d.send?.messageId || null, message: 'Another request is already sending this draft. It was not sent twice.' };
    try {
      const r = await withMailbox(who.user, claim.d.mailbox, async (api, box) => { needCaps(box, 'send'); return api.sendDraft(claim.d.providerDraftId); });
      const done = await mutate(db => { const x = own(db, who, a.draft_id); x.send = { ...x.send, status: 'sent', messageId: r?.messageId || null, at: new Date().toISOString() }; return structuredClone(x); });
      return { ...aiPreview(done), status: 'sent', provider_message_id: done.send.messageId };
    } catch (e) {
      const unknown = ambiguous(e);
      const after = await mutate(db => { const x = own(db, who, a.draft_id); x.send = unknown ? { ...x.send, status: 'unknown' } : null; return structuredClone(x); });
      if (unknown) return { ...aiPreview(after), status: 'send_status_unknown', message: 'The mail provider did not confirm the send. Nothing will be resent until Lockbox checks whether it went out. Call send_draft again later.' };
      throw err(e.status === 409 ? e.message : 'The mail provider refused to send this draft. Nothing was sent.', e.status === 409 ? 409 : 502);
    }
  }

  /** Owner approval from a trusted Lockbox screen. Only the version whose hash the owner saw is approved. */
  const approve = (owner, id, hash) => mutate(db => {
    const d = db.drafts[id]; if (!d || d.owner !== owner) throw err('Draft not found.', 404);
    if (d.hash !== hash) throw err('This draft changed after you opened it. Review the new version.', 409);
    if (d.send?.status === 'sent') throw err('Already sent.', 409);
    d.approval = { hash, at: new Date().toISOString() }; return ownerPreview(d);
  });
  const ownerView = (owner, id) => mutate(db => { const d = db.drafts[id]; if (!d || d.owner !== owner) return null; return ownerPreview(d); });

  return { create, update, send, approve, ownerView };
}
