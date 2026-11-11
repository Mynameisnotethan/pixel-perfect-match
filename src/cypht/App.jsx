import { useEffect, useMemo, useRef, useState } from 'react';
import { initialAccounts, initialContacts, initialSettings, seedMessages } from './data.js';

const STORE = 'cypht-preview:v1:';
function useSaved(key, initial) {
  const [value, setValue] = useState(() => {
    try { const saved = localStorage.getItem(STORE + key); return saved ? JSON.parse(saved) : typeof initial === 'function' ? initial() : initial; }
    catch { return typeof initial === 'function' ? initial() : initial; }
  });
  useEffect(() => { try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* Preview also works without browser storage. */ } }, [key, value]);
  return [value, setValue];
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
const emptyDraft = account => ({ account, to: '', cc: '', bcc: '', subject: '', body: '', attachments: [] });
const titles = { everything: 'Everything', unread: 'Unread', flagged: 'Flagged', junk: 'Junk', trash: 'Trash', drafts: 'Drafts', sent: 'Sent', archive: 'Archive', search: 'Search', contacts: 'Contacts', calendar: 'Calendar', servers: 'Servers', settings: 'Site Settings', save: 'Save Settings', feeds: 'Feeds' };

export default function App() {
  const [accounts, setAccounts] = useSaved('accounts', initialAccounts);
  const [messages, setMessages] = useSaved('messages', seedMessages);
  const [contacts, setContacts] = useSaved('contacts', initialContacts);
  const [settings, setSettings] = useSaved('settings', initialSettings);
  const [events, setEvents] = useSaved('events', []);
  const [view, setView] = useState('everything');
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState([]);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [groups, setGroups] = useState({ email: true, settings: true, feeds: false });
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const [sourceIds, setSourceIds] = useState(null);
  const [contactSearch, setContactSearch] = useState('');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const uploadRef = useRef(null);

  useEffect(() => { document.documentElement.dataset.bsTheme = settings.theme === 'darkly' ? 'dark' : 'light'; }, [settings.theme]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { setPage(1); setSelected([]); }, [view, query, sourceIds]);
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') { setCurrent(null); setSidebar(false); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  const notify = text => setToast(text);
  const go = next => { setView(next); setCurrent(null); setSelected([]); setSidebar(false); setQuery(''); };
  const accountFor = id => accounts.find(a => a.id === id);
  const updateMessages = (ids, patch) => setMessages(all => all.map(m => ids.includes(m.id) ? { ...m, ...patch } : m));
  const folderCounts = key => messages.filter(m => key === 'unread' ? m.folder === 'inbox' && !m.read : key === 'flagged' ? m.flagged && !['trash', 'junk'].includes(m.folder) : m.folder === key).length;
  const messageTime = value => new Date(value).toLocaleString('en', { timeZone: settings.timezone });
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages.filter(m => {
      if (sourceIds && !sourceIds.includes(m.account)) return false;
      let matches = true;
      if (view.startsWith('account:')) { const [, id, folder = 'inbox'] = view.split(':'); matches = m.account === id && m.folder === folder; }
      else if (view === 'everything') matches = m.folder === 'inbox';
      else if (view === 'unread') matches = m.folder === 'inbox' && !m.read;
      else if (view === 'flagged') matches = m.flagged && !['trash', 'junk'].includes(m.folder);
      else if (view === 'search') matches = !['trash', 'junk'].includes(m.folder);
      else matches = m.folder === view;
      return matches && (!needle || [m.subject, m.body, m.sender, m.email, m.to].filter(Boolean).join(' ').toLowerCase().includes(needle));
    }).sort((a, b) => sort === 'oldest' ? Date.parse(a.date) - Date.parse(b.date) : sort === 'sender' ? a.sender.localeCompare(b.sender) : sort === 'subject' ? a.subject.localeCompare(b.subject) : Date.parse(b.date) - Date.parse(a.date));
  }, [messages, view, query, sort, sourceIds]);
  const pages = Math.max(1, Math.ceil(visible.length / Number(settings.pageSize)));
  const activePage = Math.min(page, pages);
  const pageMessages = visible.slice((activePage - 1) * Number(settings.pageSize), activePage * Number(settings.pageSize));
  const active = messages.find(m => m.id === current);
  const mailboxView = !['contacts', 'calendar', 'servers', 'settings', 'save', 'feeds'].includes(view);
  const title = view.startsWith('account:') ? `${accountFor(view.split(':')[1])?.name || 'Account'} › ${(view.split(':')[2] || 'inbox').replace(/^./, c => c.toUpperCase())}` : titles[view] || 'Everything';
  const openMessage = message => { if (message.folder === 'drafts') { setDraft({ ...emptyDraft(message.account), ...message }); return; } setCurrent(message.id); updateMessages([message.id], { read: true }); };
  const toggleSelected = id => setSelected(all => all.includes(id) ? all.filter(v => v !== id) : [...all, id]);
  function compose(kind = 'new', message = null) {
    const d = emptyDraft(message?.account || accounts[0]?.id || '');
    if (message) {
      d.to = kind === 'reply' ? message.email : '';
      d.subject = `${kind === 'forward' ? 'Fwd: ' : 'Re: '}${message.subject.replace(/^(Re: |Fwd: )/i, '')}`;
      d.body = `\n\n${kind === 'forward' ? '---------- Forwarded message ----------' : `On ${formatDate(message.date)}, ${message.sender} wrote:`}\n${message.body.split('\n').map(s => '> ' + s).join('\n')}`;
    }
    setDraft(d);
  }
  function saveDraft() {
    if (!draft) return;
    const account = accountFor(draft.account);
    const message = { ...draft, id: draft.id || crypto.randomUUID(), sender: 'Me', email: account?.email || '', folder: 'drafts', read: true, flagged: false, date: new Date().toISOString(), subject: draft.subject || '(No subject)' };
    setMessages(all => [message, ...all.filter(m => m.id !== message.id)]); setDraft(null); notify('Draft saved in this browser.');
  }
  function simulateSend(event) {
    event.preventDefault();
    const account = accountFor(draft.account);
    const message = { ...draft, id: draft.id || crypto.randomUUID(), sender: 'Me', email: account?.email || '', folder: 'sent', read: true, flagged: false, date: new Date().toISOString(), subject: draft.subject || '(No subject)' };
    setMessages(all => [message, ...all.filter(m => m.id !== message.id)]); setDraft(null); notify('Preview only: moved to Sent. No email was sent.');
  }
  function remove(ids) { if (!ids.length) return; if (settings.confirmDelete) setModal({ type: 'delete', ids }); else move(ids, 'trash'); }
  function move(ids, folder) { updateMessages(ids, { folder }); setSelected([]); if (ids.includes(current)) setCurrent(null); notify(`${ids.length} sample message${ids.length === 1 ? '' : 's'} moved to ${folder}.`); }
  const nav = (key, label, icon, count = 0) => <li key={key} className={view === key ? 'selected_menu' : ''}><button className="nav-item-button" onClick={() => go(key)} title={label}><Icon name={icon} className="menu-icon" /><span className="nav-label">{label}</span>{count > 0 && <span className="nav-count">{count}</span>}</button></li>;
  const group = (key, label) => <button className="src_name section-toggle" aria-expanded={groups[key]} onClick={() => setGroups(g => ({ ...g, [key]: !g[key] }))}>{label}<Icon name={groups[key] ? 'chevron-up' : 'chevron-down'} /></button>;

  return <div className={`preview-root ${collapsed ? 'sidebar-collapsed' : ''} ${settings.compact ? 'compact' : ''}`}>
    <div className="preview-banner"><span><span className="preview-dot" /> Editable preview <span className="banner-detail">· Sample accounts and messages</span></span><button onClick={() => setModal({ type: 'about' })}>About this preview <Icon name="info-circle" /></button></div>
    <header className="mobile-header"><Tool icon="list" label="Open navigation" onClick={() => setSidebar(!sidebar)} /><img src="/assets/logo_dark.svg" alt="Cypht" /><span>{title}</span></header>
    {sidebar && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <div className="cypht-layout">
      <nav className={`folder_cell ${sidebar ? 'mobile-open' : ''}`} aria-label="Main navigation"><div className="folder_list">
        <button className="logo-button" aria-label="Cypht home" onClick={() => go('everything')}><img className="app-logo" src={settings.theme === 'darkly' ? '/assets/logo.svg' : '/assets/logo_dark.svg'} alt="Cypht" /></button>
        <ul className="folders main-folders">
          <li className="menu_search"><div className="sidebar-search"><Icon name="search" /><input aria-label="Search all messages" placeholder="Search…" value={query} onChange={e => { setQuery(e.target.value); if (!mailboxView) setView('search'); setCurrent(null); }} onKeyDown={e => { if (e.key === 'Enter') { setView('search'); setSidebar(false); } }} /></div></li>
          <li><button className="nav-item-button compose-nav" onClick={() => { compose(); setSidebar(false); }} title="Compose"><Icon name="pencil-square" className="menu-icon" /><span className="nav-label">Compose</span></button></li>
          {nav('everything', 'Everything', 'box2-fill')}
          {nav('unread', 'Unread', 'envelope-fill', folderCounts('unread'))}
          {nav('flagged', 'Flagged', 'flag-fill', folderCounts('flagged'))}
          {nav('drafts', 'Drafts', 'pencil-square', folderCounts('drafts'))}
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
          <li><button className="nav-item-button add-account-link" onClick={() => setModal({ type: 'account' })}><Icon name="plus-circle" className="menu-icon" /><span className="nav-label">Add account</span></button></li>
        </ul>}
        {group('feeds', 'Feed')}{groups.feeds && <ul className="folders">{nav('feeds', 'News feeds', 'rss')}</ul>}
        {group('settings', 'Settings')}{groups.settings && <ul className="folders">{nav('servers', 'Servers', 'pc-display-horizontal')}{nav('settings', 'Site', 'gear-wide-connected')}{nav('save', 'Save', 'download')}</ul>}
        <div className="sidebar-footer"><button onClick={() => setModal({ type: 'reset' })} title="Reset sample data"><Icon name="arrow-counterclockwise" /><span className="nav-label"> Reset</span></button><button onClick={() => notify('Preview is up to date. Real mail sync is not connected.')} title="Reload preview"><Icon name="arrow-clockwise" /><span className="nav-label"> Reload</span></button><button aria-label="Toggle sidebar width" title="Toggle sidebar width" onClick={() => setCollapsed(v => !v)}><Icon name="list" /></button></div>
      </div></nav>
      <main className="content_cell" id="main-content">
        {mailboxView && <>
          <div className="content_title inbox-heading">
            <div className="heading-main"><input type="checkbox" className="form-check-input" aria-label="Select all visible messages" checked={pageMessages.length > 0 && pageMessages.every(m => selected.includes(m.id))} onChange={e => setSelected(e.target.checked ? pageMessages.map(m => m.id) : [])} /><h1>{title}</h1><span className="list-meta">{visible.length} messages · {accounts.length} sources</span></div>
            <div className="heading-controls"><select className="form-select form-select-sm" aria-label="Sort messages" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Arrival Date ↓</option><option value="oldest">Arrival Date ↑</option><option value="sender">From A–Z</option><option value="subject">Subject A–Z</option></select><Tool icon="arrow-clockwise" label="Refresh messages" onClick={() => notify('Preview refreshed. Real mail sync is not connected.')} /><details className="sources-menu"><summary title="Sources" aria-label="Choose sources"><Icon name="folder-fill" /></summary><div className="sources-popover"><strong>Sources</strong>{accounts.map(a => <label key={a.id}><input type="checkbox" checked={!sourceIds || sourceIds.includes(a.id)} onChange={e => setSourceIds(old => e.target.checked ? [...(old || accounts.map(a => a.id)), a.id].filter((v, i, arr) => arr.indexOf(v) === i) : (old || accounts.map(a => a.id)).filter(id => id !== a.id))} /><span className="account-dot" style={{ background: a.color }} />{a.name}</label>)}<button onClick={() => setSourceIds(null)}>Show all sources</button></div></details><Tool icon="gear-wide" label="Configure view" onClick={() => go('settings')} /></div>
          </div>
          {selected.length > 0 && <div className="bulk-toolbar"><span>{selected.length} selected</span><Tool icon="envelope-open" label="Mark selected as read" onClick={() => { updateMessages(selected, { read: true }); setSelected([]); }} /><Tool icon="envelope" label="Mark selected as unread" onClick={() => { updateMessages(selected, { read: false }); setSelected([]); }} /><Tool icon="flag" label="Flag selected" onClick={() => { updateMessages(selected, { flagged: true }); setSelected([]); }} /><Tool icon="archive" label="Archive selected" onClick={() => move(selected, 'archive')} /><Tool icon="inbox" label="Move selected to Inbox" onClick={() => move(selected, 'inbox')} /><Tool icon="trash" label="Delete selected" onClick={() => remove(selected)} /><button className="btn btn-sm btn-link" onClick={() => setSelected([])}>Cancel</button></div>}
          {query && <div className="search-summary">Results for “{query}”<button onClick={() => setQuery('')}>Clear search <Icon name="x" /></button></div>}
          <div className={`mail-workspace ${active && settings.readingPane ? 'with-reading-pane' : ''}`}>
            {(!active || settings.readingPane) && <section className="mail-list" aria-label="Messages">
              <table className="message_table table"><thead><tr><th aria-label="Selection" /><th aria-label="Flag" /><th>From</th><th>Subject</th><th className="source-heading">Source</th><th className="date-heading">Date</th></tr></thead><tbody>
                {pageMessages.map(m => <tr key={m.id} className={`${!m.read ? 'unread-message' : ''} ${selected.includes(m.id) || current === m.id ? 'selected-message' : ''}`}>
                  <td className="checkbox-cell"><input type="checkbox" className="form-check-input" aria-label={`Select ${m.subject}`} checked={selected.includes(m.id)} onChange={() => toggleSelected(m.id)} /></td>
                  <td className="flag-cell"><button className={`flag-button ${m.flagged ? 'is-flagged' : ''}`} aria-label={`${m.flagged ? 'Unflag' : 'Flag'} ${m.subject}`} onClick={() => updateMessages([m.id], { flagged: !m.flagged })}><Icon name={m.flagged ? 'flag-fill' : 'flag'} /></button></td>
                  <td className="sender-cell"><button className="message-open" onClick={() => openMessage(m)}><span>{m.sender}</span><small>{m.email}</small></button></td>
                  <td className="subject-cell"><button className="message-open" onClick={() => openMessage(m)}><span className="subject-label">{!m.read && <span className="unread-dot" />}{m.subject}{m.attachments?.length > 0 && <Icon name="paperclip" className="attachment-indicator" />}</span><small>{m.body.replace(/\n/g, ' ')}</small></button></td>
                  <td className="source-cell"><span className="account-dot" style={{ background: accountFor(m.account)?.color || 'gray' }} />{accountFor(m.account)?.name || 'Account'}</td>
                  <td className="date-cell"><button className="message-open" onClick={() => openMessage(m)} title={messageTime(m.date)}>{formatDate(m.date)}</button></td>
                </tr>)}
              </tbody></table>
              {visible.length === 0 && <div className="empty-state"><Icon name={query ? 'search' : 'inbox'} /><h2>{query ? 'No matching messages' : 'No messages'}</h2><p>{query ? 'Try a different name, subject, or keyword.' : 'This folder has no sample messages.'}</p>{query && <button className="btn btn-outline-secondary" onClick={() => setQuery('')}>Clear search</button>}</div>}
              <div className="list-pagination"><span>{visible.length ? `${(activePage - 1) * Number(settings.pageSize) + 1}–${Math.min(activePage * Number(settings.pageSize), visible.length)} of ${visible.length}` : '0 messages'}</span><div><Tool icon="chevron-left" label="Previous page" disabled={activePage === 1} onClick={() => setPage(activePage - 1)} /><span>Page {activePage} of {pages}</span><Tool icon="chevron-right" label="Next page" disabled={activePage === pages} onClick={() => setPage(activePage + 1)} /></div></div>
            </section>}
            {active && <article className="message-reader"><div className="reader-toolbar"><Tool icon="arrow-left" label="Back to messages" onClick={() => setCurrent(null)}> Back</Tool><div><Tool icon="reply" label="Reply" onClick={() => compose('reply', active)} /><Tool icon="forward" label="Forward" onClick={() => compose('forward', active)} /><Tool icon={active.flagged ? 'flag-fill' : 'flag'} label="Toggle message flag" onClick={() => updateMessages([active.id], { flagged: !active.flagged })} /><Tool icon="envelope" label="Mark message unread" onClick={() => { updateMessages([active.id], { read: false }); setCurrent(null); }} /><Tool icon="archive" label="Archive message" onClick={() => move([active.id], 'archive')} /><Tool icon="inbox" label="Move message to Inbox" onClick={() => move([active.id], 'inbox')} /><Tool icon="trash" label="Delete message" onClick={() => remove([active.id])} /></div></div><div className="reader-content"><h2>{active.subject}</h2><div className="message-headers"><div className="sender-avatar">{active.sender.slice(0, 1)}</div><div><strong>{active.sender}</strong> <span>&lt;{active.email}&gt;</span><p>To: {active.to || accountFor(active.account)?.email}</p></div><time>{messageTime(active.date)}</time></div><div className="message-body">{active.body}</div>{active.attachments?.length > 0 && <div className="attachments"><h3>Attachments</h3>{active.attachments.map((a, i) => <button key={i} onClick={() => downloadText(a.name, a.content || 'Attachment metadata only. This file was not retained after closing the compose form.')}><Icon name="file-earmark-text" /><span>{a.name}</span><Icon name="download" /></button>)}</div>}<div className="reader-bottom"><button className="btn btn-outline-secondary" onClick={() => compose('reply', active)}><Icon name="reply" /> Reply</button><button className="btn btn-outline-secondary" onClick={() => compose('forward', active)}><Icon name="forward" /> Forward</button></div></div></article>}
          </div>
        </>}

        {!mailboxView && <div className="content_title page-heading"><h1>{title}</h1>{view === 'contacts' && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'contact' })}><Icon name="plus" /> Add contact</button>}{view === 'servers' && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'account' })}><Icon name="plus" /> Add account</button>}</div>}
        {view === 'contacts' && <section className="page-content"><input className="form-control contact-search" aria-label="Search contacts" placeholder="Search contacts…" value={contactSearch} onChange={e => setContactSearch(e.target.value)} /><div className="contact-grid">{contacts.filter(c => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(contactSearch.toLowerCase())).map(c => <div className="card" key={c.id}><div className="card-body"><div className="contact-avatar">{c.name.split(' ').map(s => s[0]).join('').slice(0, 2)}</div><h2>{c.name}</h2><p>{c.email}</p><small>{c.company || 'Local contact'}</small><div className="contact-actions"><button className="btn btn-sm btn-outline-secondary" onClick={() => { compose(); setDraft(d => ({ ...d, to: c.email })); }}>Compose</button><Tool icon="pencil" label={`Edit ${c.name}`} onClick={() => setModal({ type: 'contact', contact: c })} /><Tool icon="trash" label={`Remove ${c.name}`} onClick={() => { setContacts(all => all.filter(v => v.id !== c.id)); notify('Sample contact removed.'); }} /></div></div></div>)}</div>{!contacts.some(c => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(contactSearch.toLowerCase())) && <p className="muted-copy">No matching contacts.</p>}</section>}
        {view === 'servers' && <section className="page-content"><p className="muted-copy">Manage the sample accounts shown in your preview. Real server authentication is not connected.</p><div className="server-grid">{accounts.map(a => <div className="card" key={a.id}><div className="card-body"><h2><span className="account-dot" style={{ background: a.color }} />{a.name}</h2><p>{a.email}</p><dl><dt>Protocol</dt><dd>{a.type || 'IMAP'}</dd><dt>Server</dt><dd>{a.host || 'Not configured'}</dd><dt>Port</dt><dd>{a.port || '993'}</dd><dt>Status</dt><dd><span className="sample-badge">Sample account</span></dd></dl><div className="contact-actions"><button className="btn btn-sm btn-outline-secondary" onClick={() => setModal({ type: 'account', account: a })}>Edit</button><button className="btn btn-sm btn-outline-danger" onClick={() => setModal({ type: 'remove-account', account: a })}>Remove</button></div></div></div>)}</div></section>}
        {view === 'settings' && <section className="page-content settings-content"><h2>General</h2><p className="muted-copy">Changes apply immediately and are saved in this browser.</p><div className="settings-row"><label htmlFor="theme">Theme</label><select id="theme" className="form-select" value={settings.theme} onChange={e => setSettings(s => ({ ...s, theme: e.target.value }))}><option value="default">Default (light)</option><option value="darkly">Dark</option></select></div><div className="settings-row"><label htmlFor="page-size">Messages per page</label><select id="page-size" className="form-select" value={settings.pageSize} onChange={e => setSettings(s => ({ ...s, pageSize: Number(e.target.value) }))}>{[10, 20, 50].map(n => <option key={n}>{n}</option>)}</select></div><div className="settings-row"><label htmlFor="timezone">Display time zone</label><select id="timezone" className="form-select" value={settings.timezone} onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}>{['America/Toronto', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'UTC'].map(z => <option key={z}>{z}</option>)}</select></div><h2 className="settings-section-title">Message list</h2>{[['compact', 'Compact message rows', 'Show more messages with less vertical spacing.'], ['readingPane', 'Reading pane', 'Keep the message list visible when opening a message.'], ['confirmDelete', 'Confirm before deleting', 'Ask before moving sample messages to Trash.']].map(([key, label, description]) => <div className="settings-row" key={key}><label htmlFor={key}>{label}<small>{description}</small></label><input id={key} className="form-check-input" type="checkbox" checked={!!settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /></div>)}<button className="btn btn-primary mt-3" onClick={() => notify('Preview settings saved in this browser.')}>Save settings</button></section>}
        {view === 'save' && <section className="page-content settings-content"><h2>Save Settings</h2><p>Your preview changes are saved automatically in this browser. Export the sample accounts, messages, contacts, events, and settings as a JSON file.</p><p className="muted-copy">This export contains preview data only. Keep real credentials out of the preview.</p><button className="btn btn-primary" onClick={() => downloadText('cypht-preview-data.json', JSON.stringify({ accounts, messages, contacts, events, settings }, null, 2), 'application/json')}><Icon name="download" /> Export preview data</button><button className="btn btn-outline-secondary ms-2" onClick={() => setModal({ type: 'reset' })}>Reset sample data</button></section>}
        {view === 'calendar' && <section className="page-content calendar-content"><div className="calendar-toolbar"><div><Tool icon="chevron-left" label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} /><h2>{month.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</h2><Tool icon="chevron-right" label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} /></div><button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'event' })}><Icon name="plus" /> Add event</button></div><div className="calendar-grid">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div className="day-heading" key={d}>{d}</div>)}{Array.from({ length: Math.ceil((month.getDay() + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7 }, (_, i) => { const day = i - month.getDay() + 1; const valid = day > 0 && day <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; return <div className={`calendar-day ${valid ? '' : 'outside-month'}`} key={i}>{valid && <><button className="day-number" aria-label={`Add event on ${date}`} onClick={() => setModal({ type: 'event', date })}>{day}</button>{events.filter(e => e.date === date).map(e => <button key={e.id} className="calendar-event" title={`${e.title} ${e.time}`} onClick={() => setModal({ type: 'event-detail', event: e })}>{e.time} {e.title}</button>)}</>}</div>; })}</div><p className="muted-copy mt-3">Local preview calendar. Events are not synced to a mail provider.</p></section>}
        {view === 'feeds' && <section className="page-content"><div className="empty-state"><Icon name="rss" /><h2>No feeds connected</h2><p>Feed retrieval requires a backend connection. You can edit this screen in the preview.</p></div></section>}
      </main>
    </div>

    {draft && <Dialog title={draft.id ? 'Edit draft' : 'Compose'} wide onClose={saveDraft}><form className="compose-form" onSubmit={simulateSend}>
      <p className="compose-notice">Preview only. Sending saves a sample message to Sent; no email leaves this app.</p>
      <label className="compose-field"><span>From</span><select className="form-select" required value={draft.account} onChange={e => setDraft(d => ({ ...d, account: e.target.value }))}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} &lt;{a.email}&gt;</option>)}</select></label>
      <label className="compose-field"><span>To</span><input type="email" multiple required className="form-control" placeholder="recipient@example.test" value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} /></label>
      <details className="cc-details"><summary>Cc / Bcc</summary><label className="compose-field"><span>Cc</span><input className="form-control" type="email" multiple value={draft.cc || ''} onChange={e => setDraft(d => ({ ...d, cc: e.target.value }))} /></label><label className="compose-field"><span>Bcc</span><input className="form-control" type="email" multiple value={draft.bcc || ''} onChange={e => setDraft(d => ({ ...d, bcc: e.target.value }))} /></label></details>
      <label className="compose-field"><span>Subject</span><input className="form-control" value={draft.subject} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))} /></label>
      <textarea aria-label="Message body" className="form-control compose-body" placeholder="Write your message…" value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} />
      <input ref={uploadRef} className="visually-hidden" type="file" multiple onChange={e => { const files = Array.from(e.target.files || []); setDraft(d => ({ ...d, attachments: [...(d.attachments || []), ...files.map(f => ({ name: f.name, size: f.size }))] })); e.target.value = ''; }} />
      {draft.attachments?.length > 0 && <div className="compose-attachments">{draft.attachments.map((a, i) => <span key={i}><Icon name="paperclip" />{a.name}<button type="button" aria-label={`Remove attachment ${a.name}`} onClick={() => setDraft(d => ({ ...d, attachments: d.attachments.filter((_, j) => j !== i) }))}><Icon name="x" /></button></span>)}<small>Preview stores attachment names only.</small></div>}
      <div className="compose-footer"><button className="btn btn-primary" type="submit" disabled={!accounts.length}><Icon name="send" /> Send (preview)</button><button type="button" className="btn btn-outline-secondary" onClick={saveDraft}>Save draft</button><Tool icon="paperclip" label="Attach file" onClick={() => uploadRef.current.click()} /><button type="button" className="btn btn-link ms-auto" onClick={() => setModal({ type: 'discard' })}>Discard</button></div>
    </form></Dialog>}

    {modal?.type === 'account' && <AccountDialog account={modal.account} onClose={() => setModal(null)} onSave={account => { setAccounts(all => modal.account ? all.map(a => a.id === account.id ? account : a) : [...all, account]); setSourceIds(null); setModal(null); notify('Sample account saved. No server connection was made.'); }} />}
    {modal?.type === 'contact' && <ContactDialog contact={modal.contact} onClose={() => setModal(null)} onSave={contact => { setContacts(all => modal.contact ? all.map(c => c.id === contact.id ? contact : c) : [...all, contact]); setModal(null); notify('Contact saved in this browser.'); }} />}
    {modal?.type === 'event' && <EventDialog date={modal.date} onClose={() => setModal(null)} onSave={event => { setEvents(all => [...all, event]); setMonth(new Date(Number(event.date.slice(0, 4)), Number(event.date.slice(5, 7)) - 1, 1)); setModal(null); notify('Event added to the local preview calendar.'); }} />}
    {modal?.type === 'event-detail' && <Dialog title={modal.event.title} onClose={() => setModal(null)}><p>{modal.event.date} · {modal.event.time || 'All day'}</p><p className="my-3">{modal.event.notes}</p><button className="btn btn-outline-danger" onClick={() => { setEvents(all => all.filter(e => e.id !== modal.event.id)); setModal(null); }}>Remove event</button></Dialog>}
    {modal?.type === 'delete' && <Dialog title="Move to Trash?" onClose={() => setModal(null)}><p>Move {modal.ids.length} sample message{modal.ids.length === 1 ? '' : 's'} to Trash? You can restore them later.</p><div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-danger" onClick={() => { move(modal.ids, 'trash'); setModal(null); }}>Move to Trash</button></div></Dialog>}
    {modal?.type === 'remove-account' && <Dialog title="Remove sample account?" onClose={() => setModal(null)}><p>Remove {modal.account.email} and its sample messages from this browser?</p><div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-danger" onClick={() => { const id = modal.account.id; setAccounts(all => all.filter(a => a.id !== id)); setMessages(all => all.filter(m => m.account !== id)); setSourceIds(null); setModal(null); go('servers'); }}>Remove</button></div></Dialog>}
    {modal?.type === 'reset' && <Dialog title="Reset preview data?" onClose={() => setModal(null)}><p>This resets sample messages, accounts, drafts, contacts, calendar events, and settings in this browser. It does not affect a real mailbox.</p><div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { setAccounts(initialAccounts); setMessages(seedMessages()); setContacts(initialContacts); setEvents([]); setSettings(initialSettings); setSourceIds(null); setModal(null); go('everything'); notify('Sample data reset.'); }}>Reset sample data</button></div></Dialog>}
    {modal?.type === 'discard' && <Dialog title="Discard this draft?" onClose={() => setModal(null)}><p>Your current edits will be discarded.</p><div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Keep editing</button><button className="btn btn-danger" onClick={() => { if (draft?.id) setMessages(all => all.filter(m => m.id !== draft.id)); setDraft(null); setModal(null); }}>Discard draft</button></div></Dialog>}
    {modal?.type === 'about' && <Dialog title="About this preview" onClose={() => setModal(null)}><p>This is an editable frontend recreation of Cypht. It reuses Cypht's core stylesheet, default theme, and logos, with React components for browser preview.</p><p className="mt-3">Messages and accounts are samples saved in this browser. Sending, provider sign-in, mail synchronization, and feed retrieval are not connected.</p><p className="mt-3">The original PHP source is included in the download under reference/. It does not execute in this preview. This frontend is not a complete 1:1 functional port.</p><p className="mt-3">Cypht source and reused assets: LGPL-2.1. See LICENSE and THIRD_PARTY_NOTICES.md.</p></Dialog>}
    {toast && <div className="preview-toast" role="status"><Icon name="info-circle" />{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="x-lg" /></button></div>}
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
