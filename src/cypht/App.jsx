import { useEffect, useMemo, useRef, useState } from 'react';
import { initialAccounts, initialContacts, initialSettings, seedMessages } from './data.js';
import Compose from './Compose.jsx';
import PrivacyBar from './PrivacyBar.jsx';
import LabelManager from './LabelManager.jsx';
import AiDefaults from './AiDefaults.jsx';
import AiKeys from './AiKeys.jsx';
import { rulesFrom } from '../../connectors/feed-core.mjs';
import { usePrivacyEditor } from './PrivacyEditor.jsx';
import { addRanges, aiView, applyDefaults, labelFor, presetLabels, freshDefaults, normalizeDefaults, fieldFullyHidden, hideEntireMessage, isReceived, lockStatus, mask, mergeRanges, privacyFields, segments, selectionSegments, subtractRange, togglePrivacyField } from './privacy.js';
import { cleanHtml, draftMessage, normalizeDraft, recipient, textToHtml, htmlToText } from './compose-utils.js';
// Logos are bundled files so self-hosted servers and the desktop app can show them.
const logoDark = { url: '/brand/lockbox-logo-dark.png' };
const logoLight = { url: '/brand/lockbox-logo-light.png' };

import { liveBridge as detectLive } from './mailbox-live.js';
// Real (server/desktop) mode never shows sample data and keeps its saved data apart from the preview's.
const LIVE = typeof window !== 'undefined' && !!detectLive();
const STORE = LIVE ? 'lockbox-live:v1:' : 'cypht-preview:v1:';
function useSaved(key, initial, normalize = value => value, persist = true) {
  const store = LIVE && detectLive()?.runtime === 'desktop' ? detectLive()?.store : null;
  const name = STORE + key;
  const loadId = `${name}:${String(persist)}`;
  const fallback = () => normalize(typeof initial === 'function' ? initial() : initial);
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const ready = loaded === loadId;
  useEffect(() => {
    let active = true;
    if (persist === undefined) return () => { active = false; };
    if (!store) {
      try { const saved = localStorage.getItem(name); if (saved && persist) setValue(normalize(JSON.parse(saved))); }
      catch { setValue(fallback()); }
      if (!persist) localStorage.removeItem(name);
      setLoaded(loadId);
      return () => { active = false; };
    }
    if (!persist) {
      localStorage.removeItem(name);
      store.remove([name]).catch(() => setStorageError(true));
      setLoaded(loadId);
      return () => { active = false; };
    }
    store.get(name).then(async saved => {
      let next;
      if (saved !== undefined) next = normalize(saved);
      else {
        try { const legacy = localStorage.getItem(name); next = legacy ? normalize(JSON.parse(legacy)) : fallback(); }
        catch { next = fallback(); }
      }
      if (!active) return;
      setValue(next);
      await store.put(name, next);
      localStorage.removeItem(name); // Remove the old plaintext desktop cache after encrypted migration.
      if (active) { setStorageError(false); setLoaded(loadId); }
    }).catch(() => { if (active) { setStorageError(true); setLoaded(loadId); } });
    return () => { active = false; };
  }, [name, loadId, store, persist]);
  useEffect(() => {
    if (!ready || storageError) return;
    if (store) {
      const operation = persist ? store.put(name, value) : store.remove([name]);
      operation.then(() => setStorageError(false)).catch(() => setStorageError(true));
      return;
    }
    try {
      if (persist) localStorage.setItem(name, JSON.stringify(value)); else localStorage.removeItem(name);
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [name, value, ready, persist, store, storageError]);
  useEffect(() => {
    if (store) return;
    const sync = event => {
      if (event.key !== name || !event.newValue) return;
      try { setValue(normalize(JSON.parse(event.newValue))); } catch { /* Ignore incomplete data from another window. */ }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [name, store]);
  return [value, setValue, storageError, ready];
}
function Icon({ name, className = '' }) { return <i aria-hidden="true" className={`bi bi-${name} ${className}`} />; }
function Tool({ icon, label, onClick, disabled = false, children, className = '' }) { return <button type="button" className={`btn btn-sm btn-outline-secondary ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon name={icon} />{children}</button>; }
function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; el.showModal(); return () => { if (el.open) el.close(); }; }, []);
  return <dialog ref={ref} className={`preview-dialog ${wide ? 'wide' : ''}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <header className="dialog-heading"><h2>{title}</h2><Tool icon="x-lg" label="Close dialog" onClick={onClose} /></header><div className="dialog-body">{children}</div>
  </dialog>;
}
function formatDate(value) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value)); }
function downloadText(name, text, type = 'text/plain') { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const emptyDraft = account => normalizeDraft({ account, subject: '', body: '', bodyHtml: '', attachments: [] }, account);
const titles = { ai: 'AI Access', everything: 'Everything', unread: 'Unread', flagged: 'Flagged', junk: 'Junk', trash: 'Trash', drafts: 'Drafts', scheduled: 'Scheduled', sent: 'Sent', archive: 'Archive', search: 'Search', contacts: 'Contacts', calendar: 'Calendar', servers: 'Mailboxes', settings: 'Site Settings', save: 'Save Settings', feeds: 'Feeds' };

import MailboxDialog from './MailboxDialog.jsx';
import { useAuth } from './AuthScreens.jsx';
import { liveBridge, inboxToMessages, liveAccount, connectionInfo, downloadRemoteAttachment, fetchRemoteAttachment, forwardAttachments } from './mailbox-live.js';
import { parseAccountView } from './mailbox-view.js';
import { upsertMailbox, setStatus, removeMailbox, accountFromMailbox, mailboxId, MAILBOX_PROVIDERS, STATUS_TEXT } from './mailbox-demo.js';

export default function App() {
  const auth = useAuth();
  const [settings, setSettings, , settingsReady] = useSaved('settings', initialSettings);
  const mailPersistence = settingsReady ? !settings.onlineOnly : undefined;
  const [accounts, setAccounts] = useSaved('accounts', LIVE ? [] : initialAccounts);
  const [messages, setMessages, messagesStorageError, messagesReady] = useSaved('messages', LIVE ? [] : seedMessages, value => value, mailPersistence);
  const [contacts, setContacts] = useSaved('contacts', LIVE ? [] : initialContacts);
  const [events, setEvents] = useSaved('events', []);
  const [view, setView] = useState('everything');
  const [mailboxes, setMailboxes, , mailboxesReady] = useSaved('mailboxes', []);
  const [aiDefaults, setAiDefaults] = useSaved('ai-defaults', freshDefaults, normalizeDefaults);
  const [labels, setLabels] = useSaved('privacy-labels', presetLabels);
  const [hideLabel, setHideLabel] = useState('');
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState([]);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [drafts, setDrafts, draftsStorageError] = useSaved('open-drafts', [], value => value, mailPersistence);
  const [pendingSends, setPendingSends] = useSaved('pending-sends', [], value => value, mailPersistence);
  const [composeSettings, setComposeSettings] = useSaved('compose-settings', { undoSeconds: 5, defaultExpanded: false, confirmKeyboardSend: true, signatures: [], templates: [] });
  const [undoSend, setUndoSend] = useState(null);
  const [discarded, setDiscarded] = useState(null);
  const [toast, setToast] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [groups, setGroups] = useState({ email: true, settings: true, feeds: false });
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const [sourceIds, setSourceIds] = useState(null);
  const [contactSearch, setContactSearch] = useState('');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [popupDraftId] = useState(() => new URLSearchParams(window.location.search).get('compose'));

  useEffect(() => { document.documentElement.dataset.bsTheme = settings.theme === 'darkly' ? 'dark' : 'light'; }, [settings.theme]);
  useEffect(() => { if (!toast || undoSend || discarded) return; const id = setTimeout(() => setToast(''), 4000); return () => clearTimeout(id); }, [toast, undoSend, discarded]);
  useEffect(() => { setPage(1); setSelected([]); }, [view, query, sourceIds]);
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') { setCurrent(null); setSidebar(false); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  const draftSnapshot = JSON.stringify(drafts.map(({ saveState, ...draft }) => draft));
  useEffect(() => {
    if (!drafts.length) return;
    const timer = setTimeout(() => {
      try {
        saveNow(drafts);
        setDrafts(all => all.map(item => ({ ...item, saveState: draftsStorageError || messagesStorageError ? 'error' : 'saved' })));
      } catch {
        setDrafts(all => all.map(item => ({ ...item, saveState: 'error' })));
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [draftSnapshot, draftsStorageError, messagesStorageError]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const delivered = pendingSends.filter(item => item.deliverAt <= now);
      if (delivered.length) {
        setMessages(all => [...delivered.map(item => item.message), ...all.filter(message => !delivered.some(item => item.message.id === message.id))]);
        setPendingSends(all => all.filter(item => item.deliverAt > now));
        if (delivered.some(item => item.message.id === undoSend)) setUndoSend(null);
        notify('Preview only: moved to Sent. No email was delivered.');
      }
      const dueScheduled = messages.filter(message => message.folder === 'scheduled' && Date.parse(message.scheduledAt) <= now);
      if (dueScheduled.length) {
        setMessages(all => all.map(message => dueScheduled.some(item => item.id === message.id) ? { ...message, folder: 'sent', date: new Date().toISOString() } : message));
        notify('Scheduled demo moved to Sent. No email was delivered.');
      }
    }, 500);
    return () => clearInterval(timer);
  }, [pendingSends, messages, undoSend]);
  const notify = text => setToast(text);
  const go = next => { setView(next); setCurrent(null); setSelected([]); setSidebar(false); setQuery(''); };
  const accountFor = id => accounts.find(a => a.id === id);
  const selectedAccountView = parseAccountView(view, accounts);
  const updateMessages = (ids, patch) => setMessages(all => all.map(m => ids.includes(m.id) ? { ...m, ...patch } : m));
  const folderCounts = key => messages.filter(m => key === 'unread' ? m.folder === 'inbox' && !m.read : key === 'flagged' ? m.flagged && !['trash', 'junk'].includes(m.folder) : m.folder === key).length;
  const messageTime = value => new Date(value).toLocaleString('en', { timeZone: settings.timezone });
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages.filter(m => {
      if (sourceIds && !sourceIds.includes(m.account)) return false;
      let matches = true;
      if (selectedAccountView) matches = m.account === selectedAccountView.id && m.folder === selectedAccountView.folder;
      else if (view === 'everything') matches = m.folder === 'inbox';
      else if (view === 'unread') matches = m.folder === 'inbox' && !m.read;
      else if (view === 'flagged') matches = m.flagged && !['trash', 'junk'].includes(m.folder);
      else if (view === 'search') matches = !['trash', 'junk'].includes(m.folder);
      else matches = m.folder === view;
      return matches && (!needle || [m.subject, m.body, m.sender, m.email, m.to].filter(Boolean).join(' ').toLowerCase().includes(needle));
    }).sort((a, b) => sort === 'oldest' ? Date.parse(a.date) - Date.parse(b.date) : sort === 'sender' ? a.sender.localeCompare(b.sender) : sort === 'subject' ? a.subject.localeCompare(b.subject) : Date.parse(b.date) - Date.parse(a.date));
  }, [messages, view, query, sort, sourceIds, selectedAccountView]);
  const pages = Math.max(1, Math.ceil(visible.length / Number(settings.pageSize)));
  const activePage = Math.min(page, pages);
  const pageMessages = visible.slice((activePage - 1) * Number(settings.pageSize), activePage * Number(settings.pageSize));
  const active = messages.find(m => m.id === current);
  const pv = usePrivacyEditor({ message: active, defaults: aiDefaults, label: hideLabel, labels, onPatch: patch => updateMessages([active.id], patch) });
  const mailboxView = !['ai', 'contacts', 'calendar', 'servers', 'settings', 'save', 'feeds'].includes(view);
  const title = selectedAccountView ? `${accountFor(selectedAccountView.id)?.name || 'Account'} › ${selectedAccountView.folder.replace(/^./, c => c.toUpperCase())}` : titles[view] || 'Everything';
  const openMessage = message => {
    if (message.folder === 'drafts') {
      const restored = normalizeDraft({ ...message, minimized: false, saveState: 'saved' }, message.account);
      setDrafts(all => [...all.filter(item => item.id !== restored.id), restored]);
      return;
    }
    setCurrent(message.id); pv.setMode(null); updateMessages([message.id], isReceived(message) ? { read: true, reviewed: true } : { read: true });
  };
  const toggleSelected = id => setSelected(all => all.includes(id) ? all.filter(v => v !== id) : [...all, id]);
  async function syncLive(box) {
    const bridge = liveBridge();
    setMailboxes(list => upsertMailbox(list, { ...box, status: 'syncing' }));
    try {
      const incoming = inboxToMessages(box, await bridge.sync(box.id)).map(m => ({ ...m, ...(serverRules.current?.[m.id] || {}) }));
      setAccounts(all => [...all.filter(a => a.id !== box.id), liveAccount(box)]);
      setMessages(all => {
        const incomingIds = new Set(incoming.map(m => m.id));
        // Reconcile changed provider messages, remove mail no longer in this inbox,
        // and retain local drafts/sent copies that are not part of the inbox response.
        return [...incoming, ...all.filter(m => !incomingIds.has(m.id) && !(m.account === box.id && m.folder === 'inbox'))];
      });
      setMailboxes(list => upsertMailbox(list, { ...box, status: 'connected' })); setSourceIds(null);
    } catch (e) {
      setMailboxes(list => upsertMailbox(list, { ...box, status: e.message?.includes('reconnect_required') ? 'reconnect' : 'connected' }));
      notify(`Could not sync ${box.email}: ${e.message}`);
    }
  }
  useEffect(() => {
    const bridge = liveBridge(); if (!bridge || !messagesReady || !mailboxesReady) return;
    const result = new URLSearchParams(window.location.search).get('mailbox');
    if (result) { notify(result === 'connected' ? 'Mailbox connected. Syncing your inbox…' : 'Mailbox sign-in did not finish. Please try again.'); window.history.replaceState(null, '', window.location.pathname); }
    refreshLive();
  }, [messagesReady, mailboxesReady]);
  // Live mode: hide-from-AI rules are kept by Lockbox itself (server or desktop vault), because the AI feed
  // redacts from that copy. Load it first, then save every change; never push before loading.
  const serverRules = useRef(null);
  const [privacyLoaded, setPrivacyLoaded] = useState(false);
  useEffect(() => {
    const p = liveBridge()?.privacy; if (!p) return;
    p.get().then(doc => {
      serverRules.current = doc?.rules || {};
      setMessages(all => all.map(m => serverRules.current[m.id] ? { ...m, ...serverRules.current[m.id] } : m));
      if (doc?.defaults) setAiDefaults(doc.defaults);
      if (doc?.labels?.length) setLabels(doc.labels);
      setPrivacyLoaded(true);
    }).catch(e => notify(`Could not load your hide-from-AI settings: ${e.message}`));
  }, []);
  const privacyQueue = useRef(Promise.resolve());
  useEffect(() => {
    const p = liveBridge()?.privacy; if (!p || !privacyLoaded) return;
    let active = true;
    let retry;
    serverRules.current = { ...serverRules.current, ...rulesFrom(messages.filter(m => m.folder !== 'drafts')) };
    const doc = { rules: serverRules.current, defaults: aiDefaults, labels };
    const save = async () => {
      if (!active) return;
      try { await p.put(doc); }
      catch (e) {
        if (!active) return;
        notify(`Hide-from-AI changes were not saved. Retrying: ${e.message}`);
        retry = setTimeout(() => { privacyQueue.current = privacyQueue.current.then(save); }, 2000);
      }
    };
    // Serialize writes so an older, slower response can never overwrite a newer
    // privacy decision. A restrictive change is sent immediately, not debounced.
    privacyQueue.current = privacyQueue.current.then(save);
    return () => { active = false; clearTimeout(retry); };
  }, [messages, aiDefaults, labels, privacyLoaded]);
  function refreshLive() {
    const bridge = liveBridge(); if (!bridge) return;
    bridge.list().then(list => {
      // Drop mailboxes the server no longer has, then sync the rest.
      const ids = new Set(list.map(b => b.id));
      setMailboxes(l => l.filter(b => ids.has(b.id)));
      setAccounts(all => all.filter(a => ids.has(a.id)));
      setMessages(all => all.filter(m => ids.has(m.account)));
      setDrafts(all => all.filter(d => ids.has(d.account)));
      list.forEach(box => box.status === 'reconnect' ? setMailboxes(l => upsertMailbox(l, box)) : syncLive(box));
    }).catch(e => notify(`Could not load your mailboxes: ${e.message}`));
  }
  async function connectMailbox(provider, email, ui) {
    const bridge = liveBridge();
    if (bridge) {
      try { notify(`Finish signing in to ${provider === 'google' ? 'Google' : 'Microsoft'} in your browser…`); await syncLive(await bridge.connect(provider, ui)); }
      catch (e) { notify(`Connection did not finish: ${e.message}`); }
      return;
    }
    const id = mailboxId(provider, email);
    setMailboxes(list => upsertMailbox(list, { provider, email, status: 'connecting' }));
    setTimeout(() => setMailboxes(list => setStatus(list, id, 'syncing')), 900);
    setTimeout(() => {
      const box = { id, provider, email };
      setMailboxes(list => setStatus(list, id, 'connected'));
      setAccounts(all => all.some(a => a.id === id) ? all.map(a => a.id === id ? accountFromMailbox(box) : a) : [...all, accountFromMailbox(box)]);
      setMessages(all => all.some(m => m.id === `welcome-${id}`) ? all : [{ id: `welcome-${id}`, sender: 'Lockbox', email: 'demo@lockbox.example.test', subject: `Demo: ${email} is connected`, body: `This is a demo message. In the desktop or Docker version, your real ${provider === 'google' ? 'Gmail' : 'Outlook'} inbox syncs here and you can send from ${email}.`, account: id, folder: 'inbox', read: false, flagged: false, date: new Date().toISOString(), attachments: [] }, ...all]);
      setSourceIds(null);
    }, 2200);
  }
  async function testImap(settings) {
    const bridge = liveBridge();
    if (bridge) return bridge.imap.test(settings);
    if (!settings.imap.host || !settings.smtp.host) throw new Error('invalid_host');
    return { ok: true };
  }
  async function saveImap(settings) {
    const bridge = liveBridge();
    if (bridge) { const box = await bridge.imap.save(settings); notify(`${box.email} connected. Syncing your inbox…`); syncLive(box); return box; }
    // Demo: keep server names but never the password.
    const { password, ...rest } = settings;
    const box = { provider: 'imap', email: settings.email, status: 'connected', settings: { ...rest, hasPassword: !!password } };
    setMailboxes(list => upsertMailbox(list, box));
    const id = mailboxId('imap', settings.email);
    setAccounts(all => [...all.filter(a => a.id !== id), accountFromMailbox({ ...box, id })]);
    setSourceIds(null); notify(`${settings.email} connected (demo).`);
    return box;
  }
  async function disconnectMailbox(box) {
    try {
      await liveBridge()?.disconnect(box.id);
      setMailboxes(list => removeMailbox(list, box.id));
      setAccounts(all => all.filter(a => a.id !== box.id));
      setMessages(all => all.filter(m => m.account !== box.id));
      setDrafts(all => all.filter(d => d.account !== box.id));
      setSourceIds(null); notify(`${box.email} disconnected.`);
    } catch (e) {
      notify(`Could not disconnect ${box.email}: ${e.message}. Your mailbox and credentials were kept.`);
    }
  }
  function compose(kind = 'new', message = null, contact = null) {
    const account = message?.account || accounts[0]?.id || '';
    let d = emptyDraft(account);
    d.expanded = !!composeSettings.defaultExpanded;
    if (contact) d.recipients.to = [recipient(contact.email, contact.name)];
    if (message) {
      d.recipients.to = kind === 'reply' ? [recipient(message.email, message.sender)] : [];
      d.subject = `${kind === 'forward' ? 'Fwd: ' : 'Re: '}${message.subject.replace(/^(Re: |Fwd: )/i, '')}`;
      d.body = `\n\n${kind === 'forward' ? '---------- Forwarded message ----------' : `On ${formatDate(message.date)}, ${message.sender} wrote:`}\n${message.body.split('\n').map(s => '> ' + s).join('\n')}`;
      d.bodyHtml = textToHtml(d.body);
      if (kind === 'forward') d.attachments = forwardAttachments(message);
    }
    setDrafts(all => [...all, d]);
    // Files still on the mail server are fetched now so the forward carries the real file.
    const bridge = liveBridge();
    for (const a of d.attachments.filter(item => item.remote)) {
      const done = patch => setDrafts(all => all.map(item => item.id === d.id ? { ...item, attachments: item.attachments.map(x => x.id === a.id ? { ...x, ...patch } : x) } : item));
      if (!bridge) { done({ status: 'error', error: 'Open this email in Lockbox desktop or server to forward its files.' }); continue; }
      fetchRemoteAttachment(bridge, message.account, a).then(r => done({ content: `data:${r.type || 'application/octet-stream'};base64,${r.data}`, type: r.type || a.type, status: 'ready', progress: 100 }), () => done({ status: 'error', error: 'Could not fetch this file. Remove it or try again.' }));
    }
  }
  function updateDraft(next) { setDrafts(all => all.map(item => item.id === next.id ? { ...next, saveState: 'saving' } : item)); }
  function saveNow(list) {
    const messagesToSave = list.filter(Boolean).map(item => draftMessage(normalizeDraft(item, item.account), accountFor(item.account), 'drafts'));
    if (messagesToSave.length) setMessages(all => [...messagesToSave, ...all.filter(message => !messagesToSave.some(item => item.id === message.id))]);
  }
  function closeDraft(draft) {
    if (draftsStorageError || messagesStorageError) { notify('Browser storage is full. Remove large attachments before closing this draft.'); return; }
    saveNow([draft]); setDrafts(all => all.filter(item => item.id !== draft.id)); notify('Draft saved in this browser.');
  }
  function discardDraft(draft) {
    setMessages(all => all.filter(item => item.id !== draft.id));
    setDrafts(all => all.filter(item => item.id !== draft.id));
    setDiscarded(draft); notify('Draft discarded. You can undo this.');
  }
  async function sendDraft(draft, scheduledAt = null) {
    if (draftsStorageError || messagesStorageError) throw new Error('Browser storage is full. Your draft is preserved; remove large attachments and try again.');
    if (composeSettings.failNextSend) {
      setComposeSettings(settings => ({ ...settings, failNextSend: false }));
      throw new Error('Simulated demo failure. Your complete draft is preserved; try Send again.');
    }
    const id = draft.id;
    if (pendingSends.some(item => item.message.id === id) || messages.some(item => item.id === id && ['sent', 'scheduled'].includes(item.folder))) throw new Error('This message is already queued. Duplicate sending was prevented.');
    const account = accountFor(draft.account);
    if (account?.live && scheduledAt) throw new Error('Scheduled sending is not available for connected mailboxes yet. Your draft is preserved; use Send to deliver now.');
    if (account?.live && !scheduledAt) {
      const sent = draftMessage(draft, account, 'sent');
      await liveBridge().send(account.id, {
        to: sent.to,
        cc: sent.cc,
        bcc: (draft.recipients?.bcc || []).map(item => item.email).join(', '),
        subject: draft.subject || '',
        body: htmlToText(sent.bodyHtml || ''),
        html: sent.bodyHtml || '',
        attachments: sent.attachments || [],
      });
      setMessages(all => [{ ...sent, date: new Date().toISOString() }, ...all.filter(item => item.id !== id)]);
      setDrafts(all => all.filter(item => item.id !== id)); notify(`Sent from ${account.email}.`);
      return;
    }
    if (scheduledAt) {
      const scheduled = { ...draftMessage(draft, account, 'scheduled'), scheduledAt };
      setMessages(all => [scheduled, ...all.filter(item => item.id !== id)]);
      notify('Demo scheduled in this browser. No real email will be delivered.');
    } else {
      const pending = { message: draftMessage(draft, account, 'sent'), deliverAt: Date.now() + Number(composeSettings.undoSeconds) * 1000 };
      setPendingSends(all => [...all.filter(item => item.message.id !== id), pending]);
      setMessages(all => all.filter(item => item.id !== id));
      setUndoSend(id); notify(`Demo send queued. Undo is available for ${composeSettings.undoSeconds} seconds.`);
    }
    setDrafts(all => all.filter(item => item.id !== id));
  }
  function cancelScheduled(message) {
    const restored = normalizeDraft({ ...message, folder: 'drafts', scheduledAt: undefined, minimized: false }, message.account);
    setMessages(all => all.filter(item => item.id !== message.id));
    setDrafts(all => [...all.filter(item => item.id !== restored.id), restored]);
    notify('Scheduled demo returned to Drafts.');
  }
  function undoPending(id) {
    const pending = pendingSends.find(item => item.message.id === id);
    if (!pending) return;
    setPendingSends(all => all.filter(item => item.message.id !== id));
    const restored = normalizeDraft({ ...pending.message, folder: 'drafts', minimized: false }, pending.message.account);
    setDrafts(all => [...all.filter(item => item.id !== id), restored]);
    setUndoSend(null); notify('Demo send cancelled. Your draft is restored.');
  }
  function popoutDraft(draft) {
    saveNow([draft]);
    const url = `${window.location.origin}${window.location.pathname}?compose=${encodeURIComponent(draft.id)}`;
    const popup = window.open(url, '_blank', 'width=1000,height=800');
    if (!popup) notify('The browser blocked the compose window. Allow pop-ups and try again.');
  }
  function remove(ids) { if (!ids.length) return; if (settings.confirmDelete) setModal({ type: 'delete', ids }); else move(ids, 'trash'); }
  function move(ids, folder) { updateMessages(ids, { folder }); setSelected([]); if (ids.includes(current)) setCurrent(null); notify(LIVE ? `Moved to ${folder} in Lockbox only. Your mail provider was not changed.` : `${ids.length} sample message${ids.length === 1 ? '' : 's'} moved to ${folder}.`); }
  const nav = (key, label, icon, count = 0) => <li key={key} className={view === key ? 'selected_menu' : ''}><button className="nav-item-button" onClick={() => go(key)} title={label}><Icon name={icon} className="menu-icon" /><span className="nav-label">{label}</span>{count > 0 && <span className="nav-count">{count}</span>}</button></li>;
  const group = (key, label) => <button className="src_name section-toggle" aria-expanded={groups[key]} onClick={() => setGroups(g => ({ ...g, [key]: !g[key] }))}>{label}<Icon name={groups[key] ? 'chevron-up' : 'chevron-down'} /></button>;
  const privacyStatusLabels = { grey: 'not reviewed', green: 'fully visible to AI', yellow: 'partly hidden from AI', red: 'fully hidden from AI' };

  return <div className={`preview-root ${collapsed ? 'sidebar-collapsed' : ''} ${settings.compact ? 'compact' : ''}`}>
    <div className="preview-banner"><span><span className="preview-dot" /> {LIVE && !auth.web ? <>Lockbox</> : auth.web ? <>Signed in as <strong>{auth.user}</strong></> : <>Editable preview <span className="banner-detail">· Sample accounts and messages · Demo sign-in, no server</span></>}</span><span className="banner-actions">{auth.web && <button onClick={() => auth.signOut()}>Sign out <Icon name="box-arrow-right" /></button>}{!LIVE && <button onClick={() => setModal({ type: 'about' })}>About this preview <Icon name="info-circle" /></button>}</span></div>
    <header className="mobile-header"><Tool icon="list" label="Open navigation" onClick={() => setSidebar(!sidebar)} /><img src={settings.theme === 'darkly' ? logoLight.url : logoDark.url} alt="Lockbox" /><span>{title}</span></header>
    {sidebar && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <div className="cypht-layout">
      <nav className={`folder_cell ${sidebar ? 'mobile-open' : ''}`} aria-label="Main navigation"><div className="folder_list">
        <button className="logo-button" aria-label="Lockbox home" onClick={() => go('everything')}><img className="app-logo" src={settings.theme === 'darkly' ? logoLight.url : logoDark.url} alt="Lockbox" /></button>
        <ul className="folders main-folders">
          <li className="menu_search"><div className="sidebar-search"><Icon name="search" /><input aria-label="Search all messages" placeholder="Search…" value={query} onChange={e => { setQuery(e.target.value); if (!mailboxView) setView('search'); setCurrent(null); }} onKeyDown={e => { if (e.key === 'Enter') { setView('search'); setSidebar(false); } }} /></div></li>
          <li><button className="nav-item-button compose-nav" onClick={() => { compose(); setSidebar(false); }} title="Compose"><Icon name="pencil-square" className="menu-icon" /><span className="nav-label">Compose</span></button></li>
          {nav('everything', 'Everything', 'box2-fill')}
          {nav('unread', 'Unread', 'envelope-fill', folderCounts('unread'))}
          {nav('flagged', 'Flagged', 'flag-fill', folderCounts('flagged'))}
          {nav('drafts', 'Drafts', 'pencil-square', folderCounts('drafts'))}
          {nav('scheduled', 'Scheduled', 'clock-history', folderCounts('scheduled'))}
          {nav('sent', 'Sent', 'send')}
          {nav('archive', 'Archive', 'archive')}
          {nav('junk', 'Junk', 'envelope-x-fill')}
          {nav('trash', 'Trash', 'trash3-fill')}
          {nav('contacts', 'Contacts', 'person-vcard')}
          {nav('calendar', 'Calendar', 'calendar3')}
        </ul>
        {group('email', 'Email')}
        {groups.email && <ul className="folders account-folders">
          {nav('everything', 'All', 'globe-americas')}
          {accounts.map(a => <li key={a.id} className={view === `account:${a.id}` ? 'selected_menu' : ''}>
            <div className="account-row"><button className="account-expander" title={`Show folders for ${a.name}`} aria-label={`Show folders for ${a.name}`} aria-expanded={!!expandedAccounts[a.id]} onClick={() => setExpandedAccounts(all => ({ ...all, [a.id]: !all[a.id] }))}><Icon name={expandedAccounts[a.id] ? 'caret-down-fill' : 'caret-right-fill'} /></button><button className="nav-item-button" onClick={() => go(`account:${a.id}`)} title={a.email}><span className="account-dot" style={{ background: a.color }} /><span className="nav-label account-email">{a.email}</span></button></div>
            {expandedAccounts[a.id] && <ul className="inner_list">{['inbox', 'sent', 'drafts', 'archive', 'trash'].map(folder => <li key={folder}><button className={`nav-item-button ${view === `account:${a.id}:${folder}` ? 'sub-active' : ''}`} onClick={() => go(`account:${a.id}:${folder}`)}><Icon name={folder === 'inbox' ? 'inbox' : 'folder'} className="menu-icon" />{folder.replace(/^./, c => c.toUpperCase())}</button></li>)}</ul>}
          </li>)}
          <li><button className="nav-item-button add-account-link" onClick={() => setModal({ type: 'mailbox' })}><Icon name="plus-circle" className="menu-icon" /><span className="nav-label">Add mailbox</span></button></li>
        </ul>}
        {group('feeds', 'Feed')}{groups.feeds && <ul className="folders">{nav('feeds', 'News feeds', 'rss')}</ul>}
        {group('settings', 'Settings')}{groups.settings && <ul className="folders">{nav('servers', 'Mailboxes', 'pc-display-horizontal')}{nav('settings', 'Settings', 'gear-wide-connected')}{nav('ai', 'AI Access', 'lock-fill')}{!LIVE && nav('save', 'Save', 'download')}</ul>}
        <div className="sidebar-footer">{!LIVE && <button onClick={() => setModal({ type: 'reset' })} title="Reset sample data"><Icon name="arrow-counterclockwise" /><span className="nav-label"> Reset</span></button>}<button onClick={() => LIVE ? refreshLive() : notify('Preview is up to date. Real mail sync is not connected.')} title={LIVE ? 'Refresh mail' : 'Reload preview'}><Icon name="arrow-clockwise" /><span className="nav-label"> Reload</span></button>{auth.web && <button onClick={() => auth.signOut()} title="Sign out"><Icon name="box-arrow-right" /><span className="nav-label"> Sign out</span></button>}<button aria-label="Toggle sidebar width" title="Toggle sidebar width" onClick={() => setCollapsed(v => !v)}><Icon name="list" /></button></div>
      </div></nav>
      <main className="content_cell" id="main-content">
        {mailboxView && <>
          <div className="content_title inbox-heading">
            <div className="heading-main"><input type="checkbox" className="form-check-input" aria-label="Select all visible messages" checked={pageMessages.length > 0 && pageMessages.every(m => selected.includes(m.id))} onChange={e => setSelected(e.target.checked ? pageMessages.map(m => m.id) : [])} /><h1>{title}</h1><span className="list-meta">{visible.length} messages · {accounts.length} sources</span></div>
            <div className="heading-controls"><select className="form-select form-select-sm" aria-label="Sort messages" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Arrival Date ↓</option><option value="oldest">Arrival Date ↑</option><option value="sender">From A–Z</option><option value="subject">Subject A–Z</option></select><Tool icon="arrow-clockwise" label="Refresh messages" onClick={() => LIVE ? refreshLive() : notify('Preview refreshed. Real mail sync is not connected.')} /><details className="sources-menu"><summary title="Sources" aria-label="Choose sources"><Icon name="folder-fill" /></summary><div className="sources-popover"><strong>Sources</strong>{accounts.map(a => <label key={a.id}><input type="checkbox" checked={!sourceIds || sourceIds.includes(a.id)} onChange={e => setSourceIds(old => e.target.checked ? [...(old || accounts.map(a => a.id)), a.id].filter((v, i, arr) => arr.indexOf(v) === i) : (old || accounts.map(a => a.id)).filter(id => id !== a.id))} /><span className="account-dot" style={{ background: a.color }} />{a.name}</label>)}<button onClick={() => setSourceIds(null)}>Show all sources</button></div></details><Tool icon="gear-wide" label="Configure view" onClick={() => go('settings')} /></div>
          </div>
          {selected.length > 0 && <div className="bulk-toolbar"><span>{selected.length} selected</span><Tool icon="envelope-open" label="Mark selected as read" onClick={() => { updateMessages(selected, { read: true }); setSelected([]); }} /><Tool icon="envelope" label="Mark selected as unread" onClick={() => { updateMessages(selected, { read: false }); setSelected([]); }} /><Tool icon="flag" label="Flag selected" onClick={() => { updateMessages(selected, { flagged: true }); setSelected([]); }} /><Tool icon="archive" label="Archive selected" onClick={() => move(selected, 'archive')} /><Tool icon="inbox" label="Move selected to Inbox" onClick={() => move(selected, 'inbox')} /><Tool icon="trash" label="Delete selected" onClick={() => remove(selected)} /><button className="btn btn-sm btn-link" onClick={() => setSelected([])}>Cancel</button></div>}
          {query && <div className="search-summary">Results for “{query}”<button onClick={() => setQuery('')}>Clear search <Icon name="x" /></button></div>}
          <div className={`mail-workspace ${active && settings.readingPane ? 'with-reading-pane' : ''}`}>
            {(!active || settings.readingPane) && <section className="mail-list" aria-label="Messages">
              <table className="message_table table"><thead><tr><th aria-label="Selection" /><th aria-label="Flag" /><th>From</th><th>Subject</th><th className="source-heading">Source</th><th className="date-heading">Date</th></tr></thead><tbody>
                {pageMessages.map(m => <tr key={m.id} className={`message-row ${!m.read ? 'unread-message' : ''} ${selected.includes(m.id) || current === m.id ? 'selected-message' : ''}`} onClick={() => openMessage(m)}>
                  <td className="checkbox-cell"><input type="checkbox" className="form-check-input" aria-label={`Select ${m.subject}`} checked={selected.includes(m.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSelected(m.id)} /></td>
                  <td className="flag-cell"><button className={`flag-button ${m.flagged ? 'is-flagged' : ''}`} aria-label={`${m.flagged ? 'Unflag' : 'Flag'} ${m.subject}`} onClick={e => { e.stopPropagation(); updateMessages([m.id], { flagged: !m.flagged }); }}><Icon name={m.flagged ? 'flag-fill' : 'flag'} /></button></td>
                  <td className="sender-cell"><button className="message-open" onClick={e => { e.stopPropagation(); openMessage(m); }}><span>{m.sender}</span><small>{m.email}</small></button></td>
                  <td className="subject-cell"><button className="message-open" onClick={e => { e.stopPropagation(); openMessage(m); }}><span className="subject-label">{!m.read && <span className="unread-dot" />}{m.subject}{m.attachments?.length > 0 && <Icon name="paperclip" className="attachment-indicator" />}</span><small>{segments(m.body || '', applyDefaults(m, aiDefaults).hiddenRanges).map(p => p.hidden ? mask(p.text) : p.text).join('').replace(/\n/g, ' ')}</small></button></td>
                  <td className="source-cell"><span className="account-dot" style={{ background: accountFor(m.account)?.color || 'gray' }} />{accountFor(m.account)?.name || 'Account'}</td>
                  <td className="date-cell"><button className="message-open" onClick={() => openMessage(m)} title={messageTime(m.date)}>{m.folder !== 'drafts' && <Icon name={lockStatus(m, aiDefaults) === 'green' ? 'unlock-fill' : 'lock-fill'} className={`lock-status lock-${lockStatus(m, aiDefaults)}`} />}{formatDate(m.date)}</button></td>
                </tr>)}
              </tbody></table>
              {visible.length === 0 && <div className="empty-state"><Icon name={query ? 'search' : 'inbox'} /><h2>{query ? 'No matching messages' : 'No messages'}</h2><p>{query ? 'Try a different name, subject, or keyword.' : (LIVE && mailboxes.length === 0 ? 'Connect Gmail, Outlook or any IMAP email to see your mail here.' : LIVE ? 'This folder is empty.' : 'This folder has no sample messages.')}</p>{query && <button className="btn btn-outline-secondary" onClick={() => setQuery('')}>Clear search</button>}{!query && LIVE && mailboxes.length === 0 && <button className="btn btn-primary" onClick={() => setModal({ type: 'mailbox' })}><Icon name="plus-lg" /> Add mailbox</button>}</div>}
              <div className="list-pagination"><span>{visible.length ? `${(activePage - 1) * Number(settings.pageSize) + 1}–${Math.min(activePage * Number(settings.pageSize), visible.length)} of ${visible.length}` : '0 messages'}</span><div><Tool icon="chevron-left" label="Previous page" disabled={activePage === 1} onClick={() => setPage(activePage - 1)} /><span>Page {activePage} of {pages}</span><Tool icon="chevron-right" label="Next page" disabled={activePage === pages} onClick={() => setPage(activePage + 1)} /></div></div>
            </section>}
            {active && <article className="message-reader"><div className="reader-toolbar"><Tool icon="arrow-left" label="Back to messages" onClick={() => setCurrent(null)}> Back</Tool><div>{active.folder !== 'drafts' && <Tool icon={lockStatus(active, aiDefaults) === 'green' ? 'unlock-fill' : 'lock-fill'} label={`Hide from AI — ${privacyStatusLabels[lockStatus(active, aiDefaults)]}`} className={`reader-lock lock-${lockStatus(active, aiDefaults)} ${pv.mode ? 'privacy-active' : ''}`} onClick={() => pv.setMode(pv.mode ? null : 'lock')} />}<Tool icon="reply" label="Reply" onClick={() => compose('reply', active)} /><Tool icon="forward" label="Forward" onClick={() => compose('forward', active)} /><Tool icon={active.flagged ? 'flag-fill' : 'flag'} label="Toggle message flag" onClick={() => updateMessages([active.id], { flagged: !active.flagged })} /><Tool icon="envelope" label="Mark message unread" onClick={() => { updateMessages([active.id], { read: false }); setCurrent(null); }} /><Tool icon="archive" label="Archive message" onClick={() => move([active.id], 'archive')} /><Tool icon="inbox" label="Move message to Inbox" onClick={() => move([active.id], 'inbox')} /><Tool icon="trash" label="Delete message" onClick={() => remove([active.id])} /></div></div><div className={`reader-content ${pv.mode ? 'privacy-editing' : ''}`}>{pv.mode ? <section className="privacy-section privacy-subject-section" aria-label="Subject privacy"><span className="privacy-field-label">Subject</span><h2>{pv.text('subject', active.subject, pv.eff.hiddenSubjectRanges)}</h2></section> : <h2>{active.subject}</h2>}<div className="message-headers"><div className="sender-avatar">{active.sender.slice(0, 1)}</div><div className="sender-details">{pv.mode && !isReceived(active) ? <div className="privacy-sender-fields"><div className="privacy-header-row"><span className="privacy-field-label">To</span><span>{pv.text('to', active.to || '', pv.eff.hiddenToRanges, true, 'recipients')}</span></div></div> : pv.mode ? <div className="privacy-sender-fields"><div className="privacy-header-row"><span className="privacy-field-label">Name</span><strong>{pv.text('sender', active.sender, pv.eff.hiddenSenderRanges, true)}</strong></div><div className="privacy-header-row"><span className="privacy-field-label">Email</span><span>{pv.text('email', active.email, pv.eff.hiddenEmailRanges, true)}</span></div></div> : <><strong>{active.sender}</strong> <span>&lt;{active.email}&gt;</span></>}{!(pv.mode && !isReceived(active)) && <p>To: {active.to || accountFor(active.account)?.email}</p>}</div><time>{messageTime(active.date)}</time></div>{active.folder === 'scheduled' && <div className="scheduled-notice"><Icon name="clock-history" /><span>Demo scheduled for {messageTime(active.scheduledAt)}. It is processed only while this browser app is open.</span><button className="btn btn-sm btn-outline-secondary" onClick={() => cancelScheduled(active)}>Cancel send</button></div>}{pv.mode ? <section className="privacy-section privacy-body-section" aria-label="Message privacy"><span className="privacy-field-label">Message</span><div className="message-body">{pv.text('body', active.body, pv.eff.hiddenRanges)}</div></section> : <div className="message-body">{active.bodyHtml ? <div className="rich-message-content" dangerouslySetInnerHTML={{ __html: cleanHtml(active.bodyHtml) }} /> : active.body}</div>}{active.attachments?.length > 0 && <div className="attachments"><h3>Attachments</h3>{active.attachments.map((a, i) => { const hid = (pv.eff.hiddenAttachments || []).includes(i); const attLabel = labelFor(pv.eff.hiddenAttachmentLabels?.[i], labels); return <button key={i} style={pv.mode && hid && attLabel ? { '--label-color': attLabel.color } : undefined} title={pv.mode ? `${a.name} — ${hid ? `hidden from AI${attLabel ? ` (${attLabel.name})` : ''}. Tap to show.` : 'visible to AI. Tap to hide.'}` : undefined} aria-label={pv.mode ? (hid ? `Show ${a.name} to AI` : `Hide ${a.name} from AI`) : undefined} className={`${pv.mode && hid ? 'att-hidden' : ''} ${pv.pendAtts.includes(i) ? 'att-picked' : ''}`} onClick={() => { if (pv.mode) { pv.pickAttachment(i); return; } if (a.remote && liveBridge()) { notify(`Downloading ${a.name}…`); downloadRemoteAttachment(liveBridge(), active.account, a).catch(e => notify(`Couldn't download ${a.name}: ${e.message}`)); return; } if (a.content?.startsWith('data:')) { const link = document.createElement('a'); link.href = a.content; link.download = a.name; link.click(); } else downloadText(a.name, a.content || 'Attachment metadata only. Re-add the original file to download it.'); }}><Icon name={pv.mode ? (hid ? 'lock-fill' : 'unlock') : 'file-earmark-text'} /><span>{a.name}</span><Icon name={pv.mode ? (hid ? 'eye-slash' : 'eye') : 'download'} /></button>; })}</div>}{pv.mode && <PrivacyBar labels={labels} label={hideLabel} setLabel={setHideLabel} onAddLabel={l => { setLabels(x => [...x, l]); setHideLabel(l.id); }} mode={pv.mode} setMode={pv.setMode} pending={pv.pending} onClose={pv.close} onConfirm={pv.confirm} onHideAll={pv.hideAll} />}<div className="reader-bottom"><button className="btn btn-outline-secondary" onClick={() => compose('reply', active)}><Icon name="reply" /> Reply</button><button className="btn btn-outline-secondary" onClick={() => compose('forward', active)}><Icon name="forward" /> Forward</button></div></div></article>}
          </div>
        </>}

        {!mailboxView && <div className="content_title page-heading"><h1>{title}</h1>{view === 'contacts' && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'contact' })}><Icon name="plus" /> Add contact</button>}{view === 'servers' && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'mailbox' })}><Icon name="plus" /> Add mailbox</button>}</div>}
        {view === 'contacts' && <section className="page-content"><input className="form-control contact-search" aria-label="Search contacts" placeholder="Search contacts…" value={contactSearch} onChange={e => setContactSearch(e.target.value)} /><div className="contact-grid">{contacts.filter(c => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(contactSearch.toLowerCase())).map(c => <div className="card" key={c.id}><div className="card-body"><div className="contact-avatar">{c.name.split(' ').map(s => s[0]).join('').slice(0, 2)}</div><h2>{c.name}</h2><p>{c.email}</p><small>{c.company || 'Local contact'}</small><div className="contact-actions"><button className="btn btn-sm btn-outline-secondary" onClick={() => compose('new', null, c)}>Compose</button><Tool icon="pencil" label={`Edit ${c.name}`} onClick={() => setModal({ type: 'contact', contact: c })} /><Tool icon="trash" label={`Remove ${c.name}`} onClick={() => { setContacts(all => all.filter(v => v.id !== c.id)); notify('Sample contact removed.'); }} /></div></div></div>)}</div>{!contacts.some(c => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(contactSearch.toLowerCase())) && <p className="muted-copy">No matching contacts.</p>}</section>}
        {view === 'servers' && <section className="page-content"><p className="muted-copy">{LIVE ? 'Every mailbox connected to Lockbox. This is the same list as Add mailbox.' : 'Demo: mailboxes you connect in Add mailbox appear here too. Nothing connects to a real server in this preview.'}</p>
          {mailboxes.length === 0 && (LIVE || accounts.every(a => a.demo || a.live)) && <div className="empty-state"><Icon name="hdd-network" /><h2>No mailboxes yet</h2><p>Connect Gmail, Outlook or any IMAP/SMTP email.</p><button className="btn btn-primary" onClick={() => setModal({ type: 'mailbox' })}><Icon name="plus-lg" /> Add mailbox</button></div>}
          <div className="server-grid">{mailboxes.map(b => { const info = connectionInfo(b); const acct = accounts.find(a => a.id === b.id); return <div className="card" key={b.id}><div className="card-body"><h2><span className="account-dot" style={{ background: MAILBOX_PROVIDERS[b.provider].color }} />{acct?.name || (b.provider === 'imap' ? (b.settings?.name || b.email.split('@')[1]) : MAILBOX_PROVIDERS[b.provider].name)}</h2><p>{b.email}</p><dl><dt>Protocol</dt><dd>{info.type}</dd><dt>{b.provider === 'imap' ? 'Incoming' : 'Server'}</dt><dd>{info.host || 'Not set'}:{info.port}</dd>{b.provider === 'imap' && <><dt>Outgoing</dt><dd>{info.smtpHost || 'Not set'}:{info.smtpPort}</dd></>}<dt>Status</dt><dd><span className={`mailbox-status is-${b.status}`}>{['connecting', 'syncing'].includes(b.status) && <span className="spinner-border spinner-border-sm" aria-hidden="true" />} {STATUS_TEXT[b.status] || b.status}</span></dd></dl><div className="contact-actions">{b.status === 'reconnect' && b.provider !== 'imap' && <button className="btn btn-sm btn-primary" onClick={() => connectMailbox(b.provider, b.email)}>Reconnect</button>}{b.provider === 'imap' && <button className={`btn btn-sm ${b.status === 'reconnect' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setModal({ type: 'mailbox', edit: b })}>{b.status === 'reconnect' ? 'Fix sign-in' : 'Edit'}</button>}{LIVE && b.status !== 'syncing' && b.status !== 'reconnect' && <button className="btn btn-sm btn-outline-secondary" onClick={() => syncLive(b)}><Icon name="arrow-repeat" /> Sync</button>}<button className="btn btn-sm btn-outline-danger" onClick={() => disconnectMailbox(b)}>Disconnect</button></div></div></div>; })}
          {!LIVE && accounts.filter(a => !a.demo && !a.live && !mailboxes.some(b => b.id === a.id)).map(a => <div className="card" key={a.id}><div className="card-body"><h2><span className="account-dot" style={{ background: a.color }} />{a.name}</h2><p>{a.email}</p><dl><dt>Protocol</dt><dd>{a.type || 'IMAP'}</dd><dt>Server</dt><dd>{a.host || 'Not configured'}</dd><dt>Status</dt><dd><span className="sample-badge">Sample account</span></dd></dl><div className="contact-actions"><button className="btn btn-sm btn-outline-danger" onClick={() => setModal({ type: 'remove-account', account: a })}>Remove</button></div></div></div>)}</div></section>}
        {view === 'settings' && <section className="page-content settings-content"><h2>General</h2><p className="muted-copy">Changes apply immediately and are saved {LIVE && detectLive()?.runtime === 'desktop' ? 'in encrypted storage on this computer' : 'in this browser'}.</p><div className="settings-row"><label htmlFor="theme">Theme</label><select id="theme" className="form-select" value={settings.theme} onChange={e => setSettings(s => ({ ...s, theme: e.target.value }))}><option value="default">Default (light)</option><option value="darkly">Dark</option></select></div><div className="settings-row"><label htmlFor="page-size">Messages per page</label><select id="page-size" className="form-select" value={settings.pageSize} onChange={e => setSettings(s => ({ ...s, pageSize: Number(e.target.value) }))}>{[10, 20, 50].map(n => <option key={n}>{n}</option>)}</select></div><div className="settings-row"><label htmlFor="timezone">Display time zone</label><select id="timezone" className="form-select" value={settings.timezone} onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}>{['America/Toronto', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'UTC'].map(z => <option key={z}>{z}</option>)}</select></div><h2 className="settings-section-title">Message list</h2>{[['compact', 'Compact message rows', 'Show more messages with less vertical spacing.'], ['readingPane', 'Reading pane', 'Keep the message list visible when opening a message.'], ['confirmDelete', 'Confirm before deleting', 'Ask before moving sample messages to Trash.']].map(([key, label, description]) => <div className="settings-row" key={key}><label htmlFor={key}>{label}<small>{description}</small></label><input id={key} className="form-check-input" type="checkbox" checked={!!settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /></div>)}{LIVE && <><h2 className="settings-section-title">Storage</h2><div className="settings-row"><label htmlFor="onlineOnly">Online-only email<small>Do not save messages, drafts, or queued sends on this computer. They remain in memory until Lockbox closes; provider mail is not deleted.</small></label><input id="onlineOnly" className="form-check-input" type="checkbox" checked={!!settings.onlineOnly} onChange={e => setSettings(s => ({ ...s, onlineOnly: e.target.checked }))} /></div>{detectLive()?.runtime === 'desktop' && <p className="muted-copy">When online-only is off, Lockbox saves all fields with lossless compression and authenticated encryption. The encryption key stays in your operating system’s credential vault.</p>}</>}<button className="btn btn-primary mt-3" onClick={() => notify('Settings saved.')}>Save settings</button></section>}
        {view === 'ai' && <section className="page-content settings-content ai-page">
          <nav className="ai-tabs">{[['ai-keys', 'API keys'], ['ai-hide', 'Hide by default'], ['ai-labels', 'Labels']].map(([id, t]) => <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{t}</a>)}</nav>
          <div className="ai-card" id="ai-keys"><AiKeys onNotify={notify} mailboxes={mailboxes.length ? mailboxes : accounts.map(a => ({ id: a.id, email: a.email || a.name, provider: 'google', status: 'connected' }))} onReconnect={b => connectMailbox(b.provider, b.email)} /></div>
          <div className="ai-card" id="ai-hide"><AiDefaults value={aiDefaults} onSave={setAiDefaults} onNotify={notify} /></div>
          <div className="ai-card" id="ai-labels"><h2>Hidden text labels</h2><p className="muted-copy">The AI sees the label name, like “[hidden: Financial info]”, but never the text.</p><LabelManager labels={labels} setLabels={setLabels} onNotify={notify} onAfterChange={next => { if (hideLabel && !next.some(l => l.id === hideLabel)) setHideLabel(''); }} /></div>
                  </section>}
        {view === 'save' && !LIVE && <section className="page-content settings-content"><h2>Save Settings</h2><p>Your preview changes are saved automatically in this browser. Export the sample accounts, messages, contacts, events, and settings as a JSON file.</p><p className="muted-copy">This export contains preview data only. Keep real credentials out of the preview.</p><button className="btn btn-primary" onClick={() => downloadText('cypht-preview-data.json', JSON.stringify({ accounts, messages, contacts, events, settings }, null, 2), 'application/json')}><Icon name="download" /> Export preview data</button><button className="btn btn-outline-secondary ms-2" onClick={() => setModal({ type: 'reset' })}>Reset sample data</button></section>}
        {view === 'calendar' && <section className="page-content calendar-content"><div className="calendar-toolbar"><div><Tool icon="chevron-left" label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} /><h2>{month.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</h2><Tool icon="chevron-right" label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} /></div><button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'event' })}><Icon name="plus" /> Add event</button></div><div className="calendar-grid">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div className="day-heading" key={d}>{d}</div>)}{Array.from({ length: Math.ceil((month.getDay() + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7 }, (_, i) => { const day = i - month.getDay() + 1; const valid = day > 0 && day <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; return <div className={`calendar-day ${valid ? '' : 'outside-month'}`} key={i}>{valid && <><button className="day-number" aria-label={`Add event on ${date}`} onClick={() => setModal({ type: 'event', date })}>{day}</button>{events.filter(e => e.date === date).map(e => <button key={e.id} className="calendar-event" title={`${e.title} ${e.time}`} onClick={() => setModal({ type: 'event-detail', event: e })}>{e.time} {e.title}</button>)}</>}</div>; })}</div><p className="muted-copy mt-3">Local preview calendar. Events are not synced to a mail provider.</p></section>}
        {view === 'feeds' && <section className="page-content"><div className="empty-state"><Icon name="rss" /><h2>No feeds connected</h2><p>Feed retrieval requires a backend connection. You can edit this screen in the preview.</p></div></section>}
      </main>
    </div>

    <div className="composer-stack" aria-label="Open composers">{drafts.filter(item => !popupDraftId || item.id === popupDraftId).map((item, index) => <Compose key={item.id} draft={item} defaults={aiDefaults} labels={labels} onAddLabel={l => setLabels(x => [...x, l])} index={index} accounts={accounts} contacts={contacts} settings={composeSettings} onSettings={setComposeSettings} onChange={updateDraft} onClose={closeDraft} onDiscard={discardDraft} onSend={sendDraft} onPopout={popoutDraft} />)}</div>

    {modal?.type === 'mailbox' && <Dialog title={modal.edit ? `Edit ${modal.edit.email}` : 'Add mailbox'} onClose={() => setModal(null)}><MailboxDialog key={modal.edit?.id || 'new'} editBox={modal.edit} onImapTest={testImap} onImapSave={saveImap} mailboxes={mailboxes} onConnect={connectMailbox} onReconnect={(b, ui) => connectMailbox(b.provider, b.email, ui)} onExpire={b => setMailboxes(list => setStatus(list, b.id, 'reconnect'))} onDisconnect={disconnectMailbox} onClose={() => setModal(null)} /></Dialog>}
    {modal?.type === 'account' && <AccountDialog account={modal.account} onClose={() => setModal(null)} onSave={account => { setAccounts(all => modal.account ? all.map(a => a.id === account.id ? account : a) : [...all, account]); setSourceIds(null); setModal(null); notify('Sample account saved. No server connection was made.'); }} />}
    {modal?.type === 'contact' && <ContactDialog contact={modal.contact} onClose={() => setModal(null)} onSave={contact => { setContacts(all => modal.contact ? all.map(c => c.id === contact.id ? contact : c) : [...all, contact]); setModal(null); notify('Contact saved in this browser.'); }} />}
    {modal?.type === 'event' && <EventDialog date={modal.date} onClose={() => setModal(null)} onSave={event => { setEvents(all => [...all, event]); setMonth(new Date(Number(event.date.slice(0, 4)), Number(event.date.slice(5, 7)) - 1, 1)); setModal(null); notify('Event added to the local preview calendar.'); }} />}
    {modal?.type === 'event-detail' && <Dialog title={modal.event.title} onClose={() => setModal(null)}><p>{modal.event.date} · {modal.event.time || 'All day'}</p><p className="my-3">{modal.event.notes}</p><button className="btn btn-outline-danger" onClick={() => { setEvents(all => all.filter(e => e.id !== modal.event.id)); setModal(null); }}>Remove event</button></Dialog>}
    {modal?.type === 'delete' && <Dialog title="Move to Trash?" onClose={() => setModal(null)}><p>Move {modal.ids.length} sample message{modal.ids.length === 1 ? '' : 's'} to Trash? You can restore them later.</p><div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-danger" onClick={() => { move(modal.ids, 'trash'); setModal(null); }}>Move to Trash</button></div></Dialog>}
    {modal?.type === 'remove-account' && <Dialog title="Remove sample account?" onClose={() => setModal(null)}><p>Remove {modal.account.email} and its sample messages from this browser?</p><div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-danger" onClick={() => { const id = modal.account.id; setAccounts(all => all.filter(a => a.id !== id)); setMessages(all => all.filter(m => m.account !== id)); setSourceIds(null); setModal(null); go('servers'); }}>Remove</button></div></Dialog>}
    {modal?.type === 'reset' && !LIVE && <Dialog title="Reset preview data?" onClose={() => setModal(null)}><p>This resets sample messages, accounts, drafts, contacts, calendar events, and settings in this browser. It does not affect a real mailbox.</p><div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { setAccounts(initialAccounts); setMessages(seedMessages()); setContacts(initialContacts); setEvents([]); setSettings(initialSettings); setAiDefaults(freshDefaults()); setDrafts([]); setPendingSends([]); setUndoSend(null); setDiscarded(null); setSourceIds(null); setModal(null); go('everything'); notify('Sample data reset.'); }}>Reset sample data</button></div></Dialog>}
    {modal?.type === 'about' && <Dialog title="About this preview" onClose={() => setModal(null)}><p>This is an editable frontend recreation of Cypht. It reuses Cypht's core stylesheet and default theme, with React components for browser preview.</p><p className="mt-3">Messages and accounts are samples saved in this browser. Sending, provider sign-in, mail synchronization, and feed retrieval are not connected.</p><p className="mt-3">The original PHP source is included in the download under reference/. It does not execute in this preview. This frontend is not a complete 1:1 functional port.</p><p className="mt-3">Cypht source and reused assets: LGPL-2.1. See LICENSE and THIRD_PARTY_NOTICES.md.</p></Dialog>}
    {toast && <div className="preview-toast" role="status"><Icon name="info-circle" /><span>{toast}</span>{undoSend && pendingSends.some(item => item.message.id === undoSend) && <button className="toast-action" onClick={() => undoPending(undoSend)}>Undo send</button>}{discarded && <button className="toast-action" onClick={() => { const restored = normalizeDraft(discarded, discarded.account); setDrafts(all => [...all.filter(item => item.id !== restored.id), restored]); setDiscarded(null); setToast(''); }}>Undo discard</button>}<button aria-label="Dismiss notification" onClick={() => { setToast(''); setDiscarded(null); }}><Icon name="x-lg" /></button></div>}
  </div>;
}

function AccountDialog({ account, onClose, onSave }) {
  const [form, setForm] = useState(account || { name: '', email: '', host: '', port: '993', type: 'IMAP', color: '#008080' });
  return <Dialog title={account ? 'Edit sample account' : 'Add sample account'} onClose={onClose}><form className="stacked-form" onSubmit={e => { e.preventDefault(); onSave({ ...form, id: account?.id || crypto.randomUUID() }); }}><p className="muted-copy">Preview configuration only. Do not enter passwords or real credentials; no mail server connection is made.</p>{[['name', 'Account name', 'text'], ['email', 'Email address', 'email'], ['host', 'Server hostname', 'text'], ['port', 'Port', 'number']].map(([key, label, type]) => <label key={key}>{label}<input className="form-control" type={type} required={key === 'name' || key === 'email'} min={type === 'number' ? 1 : undefined} max={type === 'number' ? 65535 : undefined} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>)}<label>Protocol<select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}><option>IMAP</option><option>JMAP</option><option>EWS</option></select></label><label>Account colour<input type="color" className="form-control form-control-color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} /></label><div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save sample account</button></div></form></Dialog>;
}
function ContactDialog({ contact, onClose, onSave }) {
  const [form, setForm] = useState(contact || { name: '', email: '', company: '', phone: '' });
  return <Dialog title={contact ? 'Edit contact' : 'Add contact'} onClose={onClose}><form className="stacked-form" onSubmit={e => { e.preventDefault(); onSave({ ...form, id: contact?.id || crypto.randomUUID() }); }}>{[['name', 'Name', 'text'], ['email', 'Email', 'email'], ['company', 'Company', 'text'], ['phone', 'Phone', 'tel']].map(([key, label, type]) => <label key={key}>{label}<input type={type} className="form-control" required={['name', 'email'].includes(key)} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>)}<div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save contact</button></div></form></Dialog>;
}
function EventDialog({ date, onClose, onSave }) {
  const today = new Date(); const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [form, setForm] = useState({ title: '', date: date || localDate, time: '10:00', notes: '' });
  return <Dialog title="Add calendar event" onClose={onClose}><form className="stacked-form" onSubmit={e => { e.preventDefault(); onSave({ ...form, id: crypto.randomUUID() }); }}><label>Title<input className="form-control" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></label><label>Date<input className="form-control" type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label><label>Time<input className="form-control" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} /></label><label>Notes<textarea className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></label><div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Add event</button></div></form></Dialog>;
}
