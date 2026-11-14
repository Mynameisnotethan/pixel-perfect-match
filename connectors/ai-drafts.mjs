// AI drafts: an agent with a "Manage drafts" key can create and edit drafts in the owner's Gmail or
// Outlook mailbox; with "Send email" it can ask to send one. Sending always needs the owner's approval of
// that exact version, given in Lockbox itself (signed-in approval page, or a native dialog on desktop).
// A tool argument can never approve. Each approved version is sent at most once.
// Shared by the Docker mail server and the desktop app.
import { createHash, randomBytes } from 'node:crypto';
import { normalizeOutgoing } from './outgoing.mjs';
import { can, canAutoSend } from './ai-perms.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const err = (message, status = 400, code = undefined) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
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
    // A scheduled time is part of what the owner approves, so changing it needs a new approval.
    ...(d.sendAt ? { send_at: d.sendAt } : {}),
  };
}
/** Draft as handed to the provider: recipient lists flattened, reply recipients included. */
const forProvider = d => { const e = effective(d); return { ...d, to: e.to, cc: e.cc, bcc: e.bcc }; };
export const contentHash = d => sha(JSON.stringify(effective(d)));

const PROVIDER_NAMES = { google: 'Gmail', microsoft: 'Outlook' };
const providerName = d => PROVIDER_NAMES[d.provider || String(d.mailbox || '').split(':')[0]] || 'mailbox';
/** Where the draft is kept: always in Lockbox; also in the mailbox's own Drafts folder once the provider accepted it. */
export function storageOf(d) {
  if (d.providerDraftId) return { storage_status: 'saved', saved_in: `Lockbox and ${providerName(d)} Drafts`, provider_draft_id: d.providerDraftId };
  return { storage_status: 'provider_failed', saved_in: 'Lockbox only', provider_draft_id: null, provider_error: d.storageError || `${providerName(d)} did not save this draft.` };
}
function scheduleOf(d) {
  if (!d.sendAt) return { send_at: null, schedule_status: null };
  const sent = d.send?.status === 'sent' && d.send.hash === d.hash;
  const approved = !!d.approval && d.approval.hash === d.hash;
  const st = d.send?.hash === d.hash ? d.send?.status : null;
  return { send_at: d.sendAt, schedule_status: sent ? 'sent' : st === 'failed' ? 'failed' : st === 'sending' || st === 'unknown' ? 'sending' : d.scheduleBlocked && !approved ? 'needs_approval' : approved ? 'queued' : 'awaiting_approval' };
}
const statusOf = d => d.send?.status === 'sent' && d.send.hash === d.hash ? 'sent' : d.send?.status === 'unknown' ? 'send_status_unknown' : d.send?.status === 'sending' ? 'sending' : 'draft';
/** What the agent is shown: never reveals parts of the original email the owner hid. */
function aiPreview(d) {
  const e = effective(d);
  const show = list => list ? list.split(', ').map(a => d.mask?.addrs?.[a.toLowerCase()] || a).join(', ') : '';
  return {
    draft_id: d.id, version: d.version, mailbox: d.mailbox, from: d.from,
    to: show(e.to), cc: show(e.cc), bcc: e.bcc, subject: d.mask?.subject || e.subject, body: e.body,
    reply_to_message_id: d.reply?.feedId || null,
    status: statusOf(d),
    approved_for_sending: !!d.approval && d.approval.hash === d.hash,
    ...storageOf(d), ...scheduleOf(d),
  };
}
const withDirect = (who, p) => ({ ...p, direct_send: canAutoSend(who.perms, p.mailbox) });
/** What the owner is shown on the approval page: the real, complete content. */
export const ownerPreview = d => ({ id: d.id, version: d.version, hash: d.hash, ...effective(d), approved: !!d.approval && d.approval.hash === d.hash, sent: d.send?.status === 'sent' && d.send.hash === d.hash, status: d.send?.status || 'draft', createdAt: d.createdAt, updatedAt: d.updatedAt, ...storageOf(d), ...scheduleOf(d) });

const pickText = (v, name, max) => { if (v === undefined) return undefined; if (typeof v !== 'string' || v.length > max) throw err(`${name} must be text (max ${max} characters).`, 400, 'validation_error'); return v; };
const pickList = (v, name) => { if (v === undefined) return undefined; if (!(typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string')))) throw err(`${name} must be a list of addresses.`, 400, 'validation_error'); return splitList(v); };
// Ambiguous = the provider may have sent it (network failure, timeout, 5xx). Clear 4xx answers mean it did not.
/** Explains a provider failure without echoing provider text (it can contain message content). */
export function providerFailure(e, d) {
  const name = providerName(d);
  if (e?.message === 'reconnect_required' || e?.status === 401) return `${name} sign-in expired. Sign in to this mailbox again in Lockbox → Mailboxes.`;
  if (e?.providerStatus === 403) return `${name} refused access${e.providerCode ? ` (${e.providerCode})` : ''}. Sign in again from Lockbox → AI Access → Edit to allow drafts.`;
  if (e?.providerStatus) return `${name} returned HTTP ${e.providerStatus}${e.providerCode ? ` (${e.providerCode})` : ''}.`;
  return `Could not reach ${name}.`;
}
const MIN_LEAD = 60_000, MAX_LEAD = 366 * 24 * 60 * 60_000;
/** send_at must name its time zone (Z or ±hh:mm) so a schedule never shifts with the server's clock. */
export function parseSendAt(v, now = Date.now()) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) throw err('send_at must be an ISO 8601 time with a time zone, for example 2026-11-20T09:00:00-05:00.', 400, 'validation_error');
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw err('send_at is not a real date.', 400, 'validation_error');
  if (t < now + MIN_LEAD) throw err('send_at must be at least one minute in the future.', 400, 'validation_error');
  if (t > now + MAX_LEAD) throw err('send_at must be within one year.', 400, 'validation_error');
  return new Date(t).toISOString();
}
const ambiguous = e => !(e.status === 409 || (e.providerStatus >= 400 && e.providerStatus < 500 && ![408, 429].includes(e.providerStatus)));

/**
 * read()/write(db) persist { drafts: { [id]: draft } } (encrypted by the caller).
 * withMailbox(owner, mailboxId, fn(api, box)) runs fn with provider draft operations for a mailbox the owner
 *   owns (it must throw otherwise); box has { id, email, provider, caps: { drafts, send } }.
 * feedFor(owner, opts) returns the owner's reviewed, redacted feed (replies may only target these).
 * confirm(ownerPreview) optional trusted native confirmation (desktop). Resolves true when the owner approves.
 */
export function createDraftService({ read, write, withMailbox, feedFor, confirm = null, permsForKey = null }) {
  let queue = Promise.resolve();
  const mutate = fn => { const run = queue.then(async () => { const db = { drafts: {}, ...((await read()) || {}) }; const out = await fn(db); await write(db); return out; }); queue = run.catch(() => {}); return run; };
  const own = (db, who, id) => { const d = typeof id === 'string' && db.drafts[id]; if (!d || d.owner !== who.user || (who.perms && !can(who.perms, d.mailbox, 'drafts'))) throw err('Draft not found.', 404, 'not_found'); return d; };
  const allowBox = (who, id, need) => { if (who.perms && !can(who.perms, id, need)) throw err(`This API key is not allowed to ${need === 'send' ? 'send from' : 'draft in'} ${id}. The owner can change this in Lockbox → AI Access → Edit.`, 403, 'key_permission_denied'); };
  const needCaps = (box, need) => {
    if (!['google', 'microsoft'].includes(box.provider)) throw err('AI drafts work with Gmail and Outlook mailboxes only.', 400, 'unsupported_mailbox');
    if (!box.caps?.[need]) throw err(`This mailbox has not allowed Lockbox to ${need === 'send' ? 'send' : 'save drafts'} for AI yet. The owner can sign in again from Lockbox → AI Access → Edit for ${box.email}, then try again. Reading still works meanwhile.`, 409, 'mailbox_authorization_required');
  };
  const validate = d => { const e = effective(d); try { normalizeOutgoing({ to: e.to, cc: e.cc, bcc: e.bcc, subject: e.subject, body: e.body }); } catch (x) { throw err(x.detail || 'The draft is not valid.', 400, 'validation_error'); } };

  async function create(who, a = {}) {
    const to = pickList(a.to, 'to') || [], cc = pickList(a.cc, 'cc') || [], bcc = pickList(a.bcc, 'bcc') || [];
    let subject = pickText(a.subject, 'subject', 998); const body = pickText(a.body, 'body', 200_000) ?? '';
    const d = { id: 'drf_' + randomBytes(12).toString('base64url'), owner: who.user, keyId: who.keyId || null, version: 1, to, cc, bcc, body, baseTo: [], baseCc: [], mask: { addrs: {} }, createdAt: new Date().toISOString() };
    let mailbox = pickText(a.mailbox, 'mailbox', 300);
    if (a.reply_to_message_id !== undefined) {
      const fid = pickText(a.reply_to_message_id, 'reply_to_message_id', 400);
      const orig = (await feedFor(who.user, {})).find(m => m.id === fid);
      if (!orig || (who.perms && !can(who.perms, orig.mailbox, 'read'))) throw err('You can only reply to an email the owner has reviewed.', 404);
      if (mailbox && mailbox !== orig.mailbox) throw err('A reply is sent from the mailbox that received the email.');
      mailbox = orig.mailbox; d.reply = { feedId: fid };
      d._orig = orig;
    }
    if (!mailbox) throw err('mailbox is required (for example google:me@gmail.com). list_messages shows mailbox ids.', 400, 'validation_error');
    d.mailbox = mailbox;
    return withMailbox(who.user, mailbox, async (api, box) => {
      allowBox(who, box.id, 'drafts'); needCaps(box, 'drafts'); d.from = box.email; d.provider = box.provider;
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
      // Kept in Lockbox even if the provider refuses, so the owner sees it and the agent can retry with update_draft.
      try { d.providerDraftId = (await api.createDraft(box.email, forProvider(d))).providerDraftId || null; }
      catch (e) { d.providerDraftId = null; d.storageError = providerFailure(e, d); console.error(`[lockbox] ai draft ${d.id} provider save failed: ${e.providerStatus || e.status || 'network'} ${e.providerCode || ''}`); }
      d.updatedAt = d.createdAt;
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
      const made = await withMailbox(who.user, mailbox, async (api, box) => { allowBox(who, box.id, 'drafts'); needCaps(box, 'drafts'); const n = { ...next, mailbox, from: box.email }; return { ...(await api.createDraft(box.email, forProvider(n))), from: box.email }; });
      await withMailbox(who.user, current.mailbox, api => api.deleteDraft(current.providerDraftId)).catch(() => {});
      Object.assign(next, { mailbox, from: made.from, providerDraftId: made.providerDraftId });
    } else if (!current.providerDraftId) {
      // The provider refused earlier: try saving it there again.
      await withMailbox(who.user, current.mailbox, async (api, box) => {
        allowBox(who, box.id, 'drafts'); needCaps(box, 'drafts');
        try { next.providerDraftId = (await api.createDraft(box.email, forProvider(next))).providerDraftId || null; delete next.storageError; }
        catch (e) { next.storageError = providerFailure(e, next); }
      });
    } else if (hash !== current.hash) {
      await withMailbox(who.user, current.mailbox, async (api, box) => { allowBox(who, box.id, 'drafts'); needCaps(box, 'drafts'); await api.updateDraft(box.email, current.providerDraftId, forProvider(next)); });
    }
    return mutate(db => {
      const d = own(db, who, a.draft_id);
      if (d.version !== current.version) throw err('The draft changed while you were editing it. Try again.', 409);
      if (contentHash(next) !== d.hash) { Object.assign(d, next, { version: d.version + 1, hash: contentHash(next), approval: null, updatedAt: new Date().toISOString() }); }
      else if (next.providerDraftId !== d.providerDraftId || next.storageError !== d.storageError) { d.providerDraftId = next.providerDraftId; if (next.storageError) d.storageError = next.storageError; else delete d.storageError; d.updatedAt = new Date().toISOString(); }
      return aiPreview(d);
    });
  }

  async function send(who, a = {}, { approvalUrl = id => `/api/ai/approve/${id}`, scheduled = false } = {}) {
    let d = await mutate(db => structuredClone(own(db, who, a.draft_id)));
    if (d.sendAt && !scheduled && d.send?.status !== 'sent') return { ...aiPreview(d), status: 'scheduled', message: 'This draft is scheduled. Lockbox sends it at send_at once approved. Use cancel_scheduled_send to send it another way.' };
    if (!d.providerDraftId) throw err(`This draft is not saved in ${providerName(d)} yet (${d.storageError || 'provider save failed'}). Call update_draft to retry saving it, then send.`, 409, 'provider_not_saved');
    if (a.version !== undefined && a.version !== d.version) throw err(`The draft is now version ${d.version}. Check the preview and ask the owner to approve that version.`, 409);
    // Reconcile an earlier attempt whose result was unclear before doing anything else.
    if (d.send && d.send.hash === d.hash && ['sending', 'unknown'].includes(d.send.status)) {
      let stillThere;
      try { stillThere = await withMailbox(who.user, d.mailbox, api => api.draftExists(d.providerDraftId)); }
      catch { return { ...aiPreview({ ...d, send: { ...d.send, status: 'unknown' } }), status: 'send_status_unknown', message: 'Could not confirm whether the earlier send went out. Nothing was resent. Try send_draft again later.' }; }
      d = await mutate(db => { const x = own(db, who, a.draft_id); x.send = stillThere ? null : { ...x.send, status: 'sent', at: new Date().toISOString() }; return structuredClone(x); });
    }
    if (d.send?.status === 'sent' && d.send.hash === d.hash) return { ...aiPreview(d), status: 'sent', provider_message_id: d.send.messageId || null, message: 'Already sent. It was not sent again.' };
    if ((!d.approval || d.approval.hash !== d.hash) && canAutoSend(who.perms, d.mailbox)) {
      // Owner pre-authorised this key for this mailbox: the exact version named in the request is approved.
      if (a.version === undefined) throw err('Pass the version you checked (from create_draft, update_draft or get_draft) so Lockbox sends exactly that email.', 400, 'version_required');
      await autoApprove(who, d.id, d.hash);
      d = await mutate(db => structuredClone(own(db, who, a.draft_id)));
    }
    if (!d.approval || d.approval.hash !== d.hash) {
      let approved = false;
      if (confirm) { try { approved = await confirm(ownerPreview(d)); } catch { approved = false; } }
      if (approved) await approve(who.user, d.id, d.hash);
      else if (scheduled) return { ...aiPreview(d), status: 'approval_required' };
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
      const r = await withMailbox(who.user, claim.d.mailbox, async (api, box) => { allowBox(who, box.id, 'send'); needCaps(box, 'send'); return api.sendDraft(claim.d.providerDraftId); });
      const done = await mutate(db => { const x = own(db, who, a.draft_id); x.send = { ...x.send, status: 'sent', messageId: r?.messageId || null, at: new Date().toISOString() }; return structuredClone(x); });
      return { ...aiPreview(done), status: 'sent', provider_message_id: done.send.messageId };
    } catch (e) {
      const unknown = ambiguous(e);
      const after = await mutate(db => { const x = own(db, who, a.draft_id); x.send = unknown ? { ...x.send, status: 'unknown' } : scheduled ? { ...x.send, status: 'failed', error: providerFailure(e, x) } : null; return structuredClone(x); });
      if (unknown) return { ...aiPreview(after), status: 'send_status_unknown', message: 'The mail provider did not confirm the send. Nothing will be resent until Lockbox checks whether it went out. Call send_draft again later.' };
      if (scheduled) return { ...aiPreview(after), status: 'failed' };
      throw err(e.status === 409 ? e.message : `${providerFailure(e, after)} Nothing was sent.`, e.status === 409 ? 409 : 502, e.status === 409 ? (e.code || 'mailbox_authorization_required') : 'provider_error');
    }
  }

  /** Owner approval from a trusted Lockbox screen. Only the version whose hash the owner saw is approved. */
  const approve = (owner, id, hash) => mutate(db => {
    const d = db.drafts[id]; if (!d || d.owner !== owner) throw err('Draft not found.', 404);
    if (d.hash !== hash) throw err('This draft changed after you opened it. Review the new version.', 409);
    if (d.send?.status === 'sent') throw err('Already sent.', 409);
    d.approval = { hash, at: new Date().toISOString() }; return ownerPreview(d);
  });
  /** Approval given by the owner's "send without per-email approval" setting, re-checked against the key now. */
  const autoApprove = (who, id, hash) => mutate(db => {
    const d = own(db, who, id);
    if (!canAutoSend(who.perms, d.mailbox)) throw err('This API key needs the owner\'s approval for each email from this mailbox.', 403, 'key_permission_denied');
    if (d.hash !== hash) throw err(`The draft is now version ${d.version}. Check the preview and send that version.`, 409, 'version_changed');
    if (d.send?.status === 'sent') throw err('Already sent.', 409, 'already_sent');
    d.approval = { hash, at: new Date().toISOString(), by: 'key', keyId: who.keyId || null };
  });
  const ownerView = (owner, id) => mutate(db => { const d = db.drafts[id]; if (!d || d.owner !== owner) return null; return ownerPreview(d); });

  async function list(who, a = {}) {
    const mailbox = pickText(a.mailbox, 'mailbox', 300);
    const n = Math.min(Math.max(Math.trunc(Number(a.limit)) || 25, 1), 100);
    return mutate(db => ({ drafts: Object.values(db.drafts)
      .filter(d => d.owner === who.user && (!mailbox || d.mailbox === mailbox) && (!who.perms || can(who.perms, d.mailbox, 'drafts')))
      .sort((x, y) => String(y.updatedAt || y.createdAt).localeCompare(String(x.updatedAt || x.createdAt))).slice(0, n).map(aiPreview) }));
  }
  const get = (who, a = {}) => mutate(db => withDirect(who, aiPreview(own(db, who, a.draft_id))));

  /** Asks the owner to review the exact current version. Never sends, even when already approved. */
  async function requestApproval(who, a = {}, { approvalUrl = id => `/api/ai/approve/${id}` } = {}) {
    const d = await mutate(db => structuredClone(own(db, who, a.draft_id)));
    if (who.perms && !can(who.perms, d.mailbox, 'send')) throw err(`This API key is not allowed to send from ${d.mailbox}.`, 403, 'key_permission_denied');
    if (a.version !== undefined && a.version !== d.version) throw err(`The draft is now version ${d.version}. Check the preview first.`, 409, 'version_changed');
    if (statusOf(d) === 'sent') return { ...aiPreview(d), message: 'This draft was already sent.' };
    if (d.approval?.hash === d.hash) return { ...aiPreview(d), approval_url: confirm ? null : approvalUrl(d.id), message: 'Already approved. Nothing was sent.' };
    if (confirm) {
      let ok = false; try { ok = await confirm(ownerPreview(d), { approveOnly: true }); } catch { ok = false; }
      if (ok) { await approve(who.user, d.id, d.hash); return { ...aiPreview({ ...d, approval: { hash: d.hash } }), message: 'The owner approved this version. Nothing was sent yet.' }; }
      return { ...aiPreview(d), message: 'The owner did not approve this version. Nothing was sent.' };
    }
    return { ...aiPreview(d), approval_url: approvalUrl(d.id), message: 'Nothing was sent. Ask the owner to open approval_url and approve this exact version.' };
  }

  /** Sets or replaces the send time. The time is part of the approved content, so this always needs a new approval. */
  async function schedule(who, a = {}, opts = {}) {
    const sendAt = parseSendAt(a.send_at);
    const auto = await mutate(db => canAutoSend(who.perms, own(db, who, a.draft_id).mailbox));
    if (auto && a.version === undefined) throw err('Pass the version you checked (from create_draft, update_draft or get_draft) so Lockbox schedules exactly that email.', 400, 'version_required');
    const hash = await mutate(db => {
      const d = own(db, who, a.draft_id);
      if (who.perms && !can(who.perms, d.mailbox, 'send')) throw err(`This API key is not allowed to send from ${d.mailbox}.`, 403, 'key_permission_denied');
      if (a.version !== undefined && a.version !== d.version) throw err(`The draft is now version ${d.version}. Check the preview first.`, 409, 'version_changed');
      if (statusOf(d) !== 'draft') throw err('This draft was already sent or is being sent.', 409, 'already_sent');
      if (!d.providerDraftId) throw err('This draft is not saved in the mailbox yet. Call update_draft to retry saving it.', 409, 'provider_not_saved');
      if (d.sendAt !== sendAt) { d.sendAt = sendAt; d.version += 1; d.hash = contentHash(d); d.approval = null; d.send = null; d.updatedAt = new Date().toISOString(); }
      return d.hash;
    });
    if (auto) {
      await autoApprove(who, a.draft_id, hash);
      const g = await get(who, { draft_id: a.draft_id });
      return { ...g, status: 'queued', message: `Queued for ${sendAt}. Lockbox sends this exact email once at that time. It is listed in Lockbox → Scheduled.` };
    }
    return requestApproval(who, { draft_id: a.draft_id }, opts);
  }
  async function cancelSchedule(who, a = {}) {
    return mutate(db => {
      const d = own(db, who, a.draft_id);
      if (who.perms && !can(who.perms, d.mailbox, 'send')) throw err(`This API key is not allowed to send from ${d.mailbox}.`, 403, 'key_permission_denied');
      if (!d.sendAt) return { ...aiPreview(d), message: 'This draft was not scheduled.' };
      if (statusOf(d) !== 'draft') throw err('Too late: this draft was already sent or is being sent.', 409, 'already_sent');
      delete d.sendAt; d.version += 1; d.hash = contentHash(d); d.approval = null; d.send = null; d.updatedAt = new Date().toISOString();
      return { ...aiPreview(d), message: 'Schedule cancelled. Nothing was sent.' };
    });
  }
  /** Sends approved scheduled drafts whose time has come. Safe to run from a timer and after restarts. */
  let running = false;
  async function runDue(now = Date.now()) {
    if (running) return []; running = true;
    try {
      const due = await mutate(db => Object.values(db.drafts).filter(d => d.sendAt && Date.parse(d.sendAt) <= now && d.approval?.hash === d.hash && (!d.send || d.send.hash !== d.hash || ['sending', 'unknown'].includes(d.send.status))).map(d => ({ id: d.id, owner: d.owner, byKey: d.approval.by === 'key' ? d.approval.keyId : undefined, mailbox: d.mailbox })));
      const out = [];
      for (const { id, owner, byKey, mailbox } of due) {
        // Queued without the owner's per-email approval: the key must still be trusted for this mailbox now.
        if (byKey !== undefined) {
          let ok = false; try { ok = !!permsForKey && !!byKey && canAutoSend(await permsForKey(owner, byKey), mailbox); } catch { ok = false; }
          if (!ok) { await mutate(db => { const x = db.drafts[id]; if (x && x.approval?.by === 'key' && !(x.send?.status === 'sent' && x.send.hash === x.hash)) { x.approval = null; x.scheduleBlocked = true; } }); continue; }
        }
        try { out.push(await send({ user: owner, perms: null }, { draft_id: id }, { scheduled: true })); }
        catch (e) { console.error(`[lockbox] scheduled draft ${id} failed: ${e.code || e.status || 'error'}`); }
      }
      return out;
    } finally { running = false; }
  }
  /** Owner cancels a scheduled send from a trusted Lockbox screen; the email goes back to being a draft. */
  const ownerCancel = (owner, id) => mutate(db => {
    const d = db.drafts[id]; if (!d || d.owner !== owner) throw err('Draft not found.', 404, 'not_found');
    if (!d.sendAt) return ownerPreview(d);
    if (statusOf(d) !== 'draft') throw err('Too late: this email was already sent or is being sent.', 409, 'already_sent');
    delete d.sendAt; delete d.scheduleBlocked; d.version += 1; d.hash = contentHash(d); d.approval = null; d.send = null; d.updatedAt = new Date().toISOString();
    return ownerPreview(d);
  });
  const ownerList = owner => mutate(db => Object.values(db.drafts).filter(d => d.owner === owner).sort((x, y) => String(y.updatedAt || y.createdAt).localeCompare(String(x.updatedAt || x.createdAt))).map(ownerPreview));

  return { create, update, send, approve, ownerView, list, get, requestApproval, schedule, cancelSchedule, runDue, ownerList, ownerCancel };
}
