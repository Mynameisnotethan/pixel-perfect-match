import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import FontFamily from '@tiptap/extension-font-family';
import { BackgroundColor, Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import {
  MAX_ATTACHMENT_BYTES, addRecipient, cleanHtml, duplicateRecipients, formatBytes,
  htmlToText, isSafeLink, normalizeEmail, parseRecipients, recipient, textToHtml, validEmail,
} from './compose-utils.js';
import { lockStatus, syncDraftPrivacy, fieldsFor, labelFor, mask } from './privacy.js';
import { usePrivacyEditor } from './PrivacyEditor.jsx';
import PrivacyBar from './PrivacyBar.jsx';

const draftTexts = d => ({ subject: d.subject || '', to: (d.recipients?.to || []).map(item => item.email).join(', '), body: htmlToText(d.bodyHtml || '') });
const rangeKeys = d => Object.fromEntries(fieldsFor({ folder: 'drafts' }).map(({ key }) => [key, d[key]]).filter(([, v]) => v));

const EMOJIS = [
  ['😀', 'grinning smile happy'], ['😃', 'smiley happy'], ['😄', 'smile happy'], ['😂', 'joy laugh tears'], ['🙂', 'slight smile'], ['😉', 'wink'], ['😊', 'blush smile'], ['😍', 'heart eyes love'], ['🤩', 'star struck excited'], ['😘', 'kiss love'], ['😎', 'cool sunglasses'], ['🤔', 'thinking'], ['🤗', 'hug'], ['👍', 'thumbs up yes'], ['👎', 'thumbs down no'], ['👏', 'clap applause'], ['🙌', 'celebrate raised hands'], ['🙏', 'please thanks pray'], ['💪', 'strong muscle'], ['🎉', 'party celebration'], ['✨', 'sparkles'], ['🔥', 'fire hot'], ['❤️', 'red heart love'], ['💙', 'blue heart'], ['💚', 'green heart'], ['✅', 'check done yes'], ['⭐', 'star favorite'], ['📌', 'pin'], ['📎', 'paperclip attachment'], ['📅', 'calendar date'], ['📞', 'phone call'], ['✉️', 'email envelope'], ['💡', 'idea light'], ['🚀', 'rocket launch'], ['🌈', 'rainbow'], ['☀️', 'sun sunny'], ['🌙', 'moon night'], ['☕', 'coffee'], ['🍕', 'pizza'], ['🎂', 'birthday cake'],
].map(([char, name]) => ({ char, name }));
const FONTS = [{ label: 'Sans Serif', value: 'Arial, Helvetica, sans-serif' }, { label: 'Serif', value: 'Georgia, serif' }, { label: 'Monospace', value: 'monospace' }, { label: 'Verdana', value: 'Verdana, sans-serif' }];
const SIZES = [{ label: 'Small', value: '12px' }, { label: 'Normal', value: '14px' }, { label: 'Large', value: '18px' }, { label: 'Huge', value: '24px' }];

function Icon({ name }) { return <i className={`bi bi-${name}`} aria-hidden="true" />; }
function ComposeTool({ icon, label, onClick, active = false, disabled = false, children, className = '', type = 'button' }) {
  return <button type={type} className={`compose-tool ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active || undefined} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} />}{children}</button>;
}
function ComposeDialog({ title, onClose, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const element = ref.current; element.showModal(); return () => { if (element.open) element.close(); }; }, []);
  return <dialog ref={ref} className={`composer-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}><header><h2>{title}</h2><ComposeTool icon="x-lg" label="Close dialog" onClick={onClose} /></header><div className="compose-dialog-body">{children}</div></dialog>;
}
function fileData(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
function suggestedTimes() {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0);
  const monday = new Date(); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7)); monday.setHours(8, 0, 0, 0);
  return [{ label: 'Tomorrow morning', date: tomorrow }, { label: 'Monday morning', date: monday }];
}
function localInputDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function RecipientField({ field, label, items, contacts, value, onInput, onChange, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const matches = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (!needle) return [];
    return contacts.filter(contact => `${contact.name} ${contact.email}`.toLowerCase().includes(needle) && !items.some(item => item.email === contact.email.toLowerCase())).slice(0, 6);
  }, [contacts, items, value]);
  function commit(raw = value, choose) {
    const addresses = choose ? [choose.email] : parseRecipients(raw);
    if (!addresses.length) { setError(''); return true; }
    let next = items;
    for (const address of addresses) {
      const result = addRecipient(next, address, choose?.name || contacts.find(contact => contact.email.toLowerCase() === address)?.name);
      if (result.error) { setError(result.error); return false; }
      next = result.list;
    }
    onChange(next); onInput(''); setError(''); setOpen(false); setActive(0); return true;
  }
  return <div className={`recipient-line ${error ? 'has-error' : ''}`}>
    <span className="recipient-label">{label}</span>
    <div className="recipient-editor" onClick={() => inputRef.current?.focus()}>
      {items.map((item, index) => <span className="recipient-chip" key={item.email} title={item.email}>
        <span>{item.name && item.name !== item.email.split('@')[0] ? item.name : item.email}</span>
        <button type="button" aria-label={`Edit ${item.email}`} onClick={() => { onInput(item.email); onChange(items.filter((_, i) => i !== index)); inputRef.current?.focus(); }}><Icon name="pencil" /></button>
        <button type="button" aria-label={`Remove ${item.email}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Icon name="x" /></button>
      </span>)}
      <input ref={inputRef} autoFocus={autoFocus} aria-label={`${label} recipients`} value={value} placeholder={items.length ? '' : 'Recipients'} onChange={event => { onInput(event.target.value); setOpen(true); setError(''); setActive(0); }} onFocus={() => setOpen(true)} onBlur={() => { setTimeout(() => setOpen(false), 120); if (value.trim()) commit(); }} onPaste={event => { const text = event.clipboardData.getData('text'); if (/[,;\s]/.test(text.trim())) { event.preventDefault(); commit(text); } }} onKeyDown={event => {
        if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); setActive(index => (index + 1) % matches.length); }
        else if (event.key === 'ArrowUp' && matches.length) { event.preventDefault(); setActive(index => (index - 1 + matches.length) % matches.length); }
        else if (event.key === 'Enter' || event.key === ',' || (event.key === 'Tab' && value.trim())) { event.preventDefault(); if (open && matches[active] && event.key !== ',') commit('', matches[active]); else commit(); }
        else if (event.key === 'Backspace' && !value && items.length) onChange(items.slice(0, -1));
      }} />
    </div>
    {open && matches.length > 0 && <div className="contact-suggestions" role="listbox" aria-label={`${label} contact suggestions`}>{matches.map((contact, index) => <button type="button" role="option" aria-selected={index === active} className={index === active ? 'active' : ''} key={contact.id} onMouseDown={event => { event.preventDefault(); commit('', contact); }}><span className="suggestion-avatar">{contact.name.slice(0, 1)}</span><span><strong>{contact.name}</strong><small>{contact.email}</small></span></button>)}</div>}
    {error && <span className="recipient-error" role="alert">{error}</span>}
  </div>;
}

export default function Compose({ draft, labels = [], onAddLabel, accounts, contacts, settings, onSettings, onChange, onClose, onDiscard, onSend, onPopout, index }) {
  const draftRef = useRef(draft);
  const changeRef = useRef(onChange);
  const [inputs, setInputs] = useState({ to: draft.recipientInputs?.to || '', cc: draft.recipientInputs?.cc || '', bcc: draft.recipientInputs?.bcc || '' });
  const [recipientFields, setRecipientFields] = useState(!!(draft.recipients.cc.length || draft.recipients.bcc.length));
  const [dialog, setDialog] = useState(null);
  const [menu, setMenu] = useState('');
  const [emojiSearch, setEmojiSearch] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [linkForm, setLinkForm] = useState({ text: '', url: '' });
  const [hideLabel, setHideLabel] = useState('');
  const texts = draftTexts(draft);
  const privTarget = { ...syncDraftPrivacy(draft, texts), folder: 'drafts' };
  const pv = usePrivacyEditor({ message: privTarget, label: hideLabel, labels, onPatch: patch => update({ ...rangeKeys(privTarget), privacyTexts: draftTexts(draftRef.current), ...patch }) });
  const privStatus = lockStatus({ ...privTarget, folder: 'sent' }, {});
  const [imageForm, setImageForm] = useState({ alt: '', width: '' });
  const [linkSelection, setLinkSelection] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(localInputDate(suggestedTimes()[0].date));
  const [signatureDraft, setSignatureDraft] = useState({ id: '', name: '', text: '' });
  const [templateName, setTemplateName] = useState('');
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const fileCache = useRef(new Map());
  const sendingRef = useRef(false);
  const lastEditorHtml = useRef(cleanHtml(draft.bodyHtml));
  const rootRef = useRef(null);
  draftRef.current = draft;
  changeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
      TextStyle, Color, BackgroundColor, FontSize, FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }), Highlight.configure({ multicolor: true }), Image.configure({ inline: true, allowBase64: true }),
      Placeholder.configure({ placeholder: 'Write your message…' }),
    ],
    content: cleanHtml(draft.bodyHtml),
    editorProps: {
      attributes: { 'aria-label': 'Message body', class: 'compose-prose', role: 'textbox', 'aria-multiline': 'true' },
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name === 'image') { setImageForm({ alt: node.attrs.alt || '', width: node.attrs.width || '' }); setDialog({ type: 'image-settings' }); }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      const bodyHtml = cleanHtml(instance.getHTML());
      lastEditorHtml.current = bodyHtml;
      update({ bodyHtml, body: htmlToText(bodyHtml) });
    },
  });

  useEffect(() => {
    if (editor && draft.bodyHtml !== lastEditorHtml.current && cleanHtml(editor.getHTML()) !== cleanHtml(draft.bodyHtml)) {
      lastEditorHtml.current = cleanHtml(draft.bodyHtml);
      editor.commands.setContent(lastEditorHtml.current, { emitUpdate: false });
    }
  }, [editor, draft.bodyHtml]);
  function update(patch) {
    const next = { ...draftRef.current, ...patch, updatedAt: new Date().toISOString() };
    draftRef.current = next;
    changeRef.current(next);
  }
  useEffect(() => {
    const onDocumentClick = event => { if (rootRef.current && !rootRef.current.contains(event.target)) setMenu(''); };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);
  useEffect(() => {
    if (!editor) return;
    const onKey = event => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); openLink(); }
      if (modifier && event.key === 'Enter') { event.preventDefault(); if (settings.confirmKeyboardSend) setDialog({ type: 'confirm-send' }); else requestSend(); }
      if (event.key === 'Escape' && !dialog) { if (menu) setMenu(''); else onClose(draftRef.current); }
    };
    const element = rootRef.current;
    element?.addEventListener('keydown', onKey);
    return () => element?.removeEventListener('keydown', onKey);
  }, [editor, dialog, menu, settings.confirmKeyboardSend]);

  function setInput(field, value) {
    setInputs(all => ({ ...all, [field]: value }));
    update({ recipientInputs: { ...draftRef.current.recipientInputs, [field]: value } });
  }
  function collectRecipients() {
    let recipients = Object.fromEntries(['to', 'cc', 'bcc'].map(field => [field, [...draftRef.current.recipients[field]]]));
    for (const field of ['to', 'cc', 'bcc']) {
      for (const address of parseRecipients(inputs[field])) {
        const result = addRecipient(recipients[field], address);
        if (result.error) { setSendError(`${field.toUpperCase()}: ${result.error}`); return null; }
        recipients[field] = result.list;
      }
    }
    const duplicates = duplicateRecipients(recipients);
    if (duplicates.length) { setSendError(`Remove duplicate recipients: ${duplicates.join(', ')}`); return null; }
    if (!recipients.to.length && !recipients.cc.length && !recipients.bcc.length) { setSendError('Add at least one recipient.'); return null; }
    setInputs({ to: '', cc: '', bcc: '' });
    const next = { ...draftRef.current, recipients, recipientInputs: { to: '', cc: '', bcc: '' } };
    draftRef.current = next;
    changeRef.current(next);
    return next;
  }
  function readyDraft() {
    setSendError('');
    const next = collectRecipients();
    if (!next) return null;
    const incomplete = next.attachments.find(item => item.status === 'uploading');
    if (incomplete) { setSendError(`Wait for ${incomplete.name} to finish uploading.`); return null; }
    const failed = next.attachments.find(item => ['error', 'metadata'].includes(item.status) || !item.content);
    if (failed) { setSendError(`Re-add or remove ${failed.name}; its file is not ready.`); return null; }
    return next;
  }
  async function requestSend() {
    if (sendingRef.current) return;
    const next = readyDraft();
    if (!next) return;
    if (!next.subject.trim() || !htmlToText(next.bodyHtml).trim()) { setDialog({ type: 'empty-warning', draft: next }); return; }
    await finishSend(next);
  }
  async function finishSend(next, scheduledAt = null) {
    if (sendingRef.current) return;
    sendingRef.current = true; setSending(true); setDialog(null); setSendError('');
    await new Promise(resolve => setTimeout(resolve, 450));
    next = syncDraftPrivacy(next, draftTexts(next));
    try { await onSend(next, scheduledAt); }
    catch (error) { setSendError(error.message || 'The demo send failed. Your draft is still here.'); sendingRef.current = false; setSending(false); }
  }
  function openSchedule() {
    const next = readyDraft();
    if (next) setDialog({ type: 'schedule', draft: next });
  }
  function openLink() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setLinkSelection({ from, to });
    setLinkForm({ text: editor.state.doc.textBetween(from, to, ' '), url: editor.getAttributes('link').href || 'https://' });
    setDialog({ type: 'link' }); setMenu('');
  }
  function applyLink() {
    if (!isSafeLink(linkForm.url)) { setSendError('Use an http, https, mailto, or tel link.'); return; }
    const href = linkForm.url;
    editor.chain().focus();
    if (linkSelection) editor.chain().setTextSelection(linkSelection);
    if (editor.state.selection.empty && linkForm.text.trim()) editor.chain().insertContent(`<a href="${href.replace(/"/g, '&quot;')}">${linkForm.text.replace(/[&<>]/g, '')}</a>`).run();
    else editor.chain().extendMarkRange('link').setLink({ href }).run();
    setDialog(null); setSendError('');
  }
  async function addFiles(files, inline = false) {
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES || draftRef.current.attachments.reduce((sum, item) => sum + (item.size || 0), 0) + file.size > MAX_ATTACHMENT_BYTES) {
        setSendError(`${file.name} exceeds the 25 MB demo attachment limit.`); continue;
      }
      const id = crypto.randomUUID();
      fileCache.current.set(id, file);
      if (inline) {
        if (!file.type.startsWith('image/')) { setSendError(`${file.name} is not an image.`); continue; }
        try { const content = await fileData(file); editor?.chain().focus().insertContent({ type: 'image', attrs: { src: content, alt: file.name, title: file.name } }).run(); }
        catch { setSendError(`${file.name} could not be inserted.`); }
        continue;
      }
      const pending = { id, name: file.name, size: file.size, type: file.type, status: 'uploading', progress: 0 };
      update({ attachments: [...draftRef.current.attachments, pending] });
      try {
        const content = await fileData(file, progress => update({ attachments: draftRef.current.attachments.map(item => item.id === id ? { ...item, progress } : item) }));
        update({ attachments: draftRef.current.attachments.map(item => item.id === id ? { ...item, content, status: 'ready', progress: 100 } : item) });
      } catch {
        update({ attachments: draftRef.current.attachments.map(item => item.id === id ? { ...item, status: 'error', error: 'Upload failed. Try again.' } : item) });
      }
    }
    if (fileRef.current) fileRef.current.value = '';
    if (photoRef.current) photoRef.current.value = '';
  }
  function retryAttachment(attachment) {
    const file = fileCache.current.get(attachment.id);
    if (!file) { setSendError('This file came from an older draft. Remove it and choose the file again.'); return; }
    update({ attachments: draftRef.current.attachments.filter(item => item.id !== attachment.id) });
    addFiles([file]);
  }
  function applySignature(signature) {
    if (!editor) return;
    const container = document.createElement('div'); container.innerHTML = cleanHtml(editor.getHTML());
    container.querySelectorAll('[data-signature]').forEach(element => element.remove());
    if (signature) {
      const block = document.createElement('div'); block.dataset.signature = signature.id; block.innerHTML = cleanHtml(signature.html || textToHtml(signature.text));
      container.append(document.createElement('br'), block);
    }
    const bodyHtml = cleanHtml(container.innerHTML);
    editor.commands.setContent(bodyHtml); update({ bodyHtml, body: htmlToText(bodyHtml), signatureId: signature?.id || '' }); setDialog(null);
  }
  function switchPlainText() {
    const text = htmlToText(editor.getHTML()); const html = textToHtml(text);
    editor.commands.setContent(html); update({ plainText: true, body: text, bodyHtml: html }); setDialog(null); setMenu('');
  }
  function printDraft() {
    const popup = window.open('', '_blank', 'width=760,height=700');
    if (!popup) { setSendError('Allow pop-ups to print this draft.'); return; }
    popup.document.write(`<title>${draft.subject || 'Draft'}</title><body style="font:14px Arial;padding:32px">${cleanHtml(editor.getHTML())}</body>`);
    popup.document.close(); popup.focus(); popup.print(); setMenu('');
  }
  function insertTemplate(template) {
    editor?.chain().focus().insertContent(cleanHtml(template.html)).run(); setDialog(null);
  }
  const signatures = settings.signatures || [];
  const templates = settings.templates || [];
  const emojiList = EMOJIS.filter(emoji => !emojiSearch || emoji.name.includes(emojiSearch.toLowerCase()) || emoji.char.includes(emojiSearch));
  const account = accounts.find(item => item.id === draft.account);

  return <section ref={rootRef} className={`gmail-composer ${draft.minimized ? 'is-minimized' : ''} ${draft.expanded ? 'is-expanded' : ''}`} style={{ '--composer-index': index }} aria-label={draft.subject ? `Compose: ${draft.subject}` : 'New Message'} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
    <header className="composer-titlebar" onDoubleClick={() => update({ minimized: !draft.minimized })}>
      <button className="composer-title" onClick={() => update({ minimized: false })}>{draft.subject || 'New Message'}</button>
      <div><ComposeTool icon="dash-lg" label={draft.minimized ? 'Restore composer' : 'Minimize composer'} onClick={() => update({ minimized: !draft.minimized })} /><ComposeTool icon={draft.expanded ? 'fullscreen-exit' : 'arrows-fullscreen'} label="Expand composer (Shift-click for separate window)" onClick={event => { if (event.shiftKey) onPopout(draftRef.current); else update({ expanded: !draft.expanded, minimized: false }); }} /><ComposeTool icon="x-lg" label="Close and save draft" onClick={() => onClose(draftRef.current)} /></div>
    </header>
    {!draft.minimized && <div className="composer-content">
      <div className="sender-row"><label htmlFor={`sender-${draft.id}`}>From</label><select id={`sender-${draft.id}`} aria-label="Sending account" value={draft.account} onChange={event => update({ account: event.target.value })}>{accounts.map(item => <option value={item.id} key={item.id}>{item.name} &lt;{item.email}&gt;</option>)}</select></div>
      {!pv.mode && <><div className="recipients-heading"><button type="button" onClick={() => setRecipientFields(value => !value)} aria-expanded={recipientFields}>Recipients</button><div>{!recipientFields && <><button type="button" onClick={() => { setRecipientFields(true); }}>Cc</button><button type="button" onClick={() => { setRecipientFields(true); update({ showBcc: true }); }}>Bcc</button></>}</div></div>
      <RecipientField field="to" label="To" items={draft.recipients.to} contacts={contacts} value={inputs.to} onInput={value => setInput('to', value)} onChange={items => update({ recipients: { ...draftRef.current.recipients, to: items } })} autoFocus={!draft.body} />
      {recipientFields && <RecipientField field="cc" label="Cc" items={draft.recipients.cc} contacts={contacts} value={inputs.cc} onInput={value => setInput('cc', value)} onChange={items => update({ recipients: { ...draftRef.current.recipients, cc: items } })} />}
      {(recipientFields && (draft.showBcc || draft.recipients.bcc.length > 0)) && <RecipientField field="bcc" label="Bcc" items={draft.recipients.bcc} contacts={contacts} value={inputs.bcc} onInput={value => setInput('bcc', value)} onChange={items => update({ recipients: { ...draftRef.current.recipients, bcc: items } })} />}
      </>}
      {pv.mode ? <div className="compose-privacy">
        <div className="privacy-header-row"><span className="privacy-field-label">To</span>{texts.to ? pv.text('to', texts.to, pv.eff.hiddenToRanges, true, 'recipients') : <em className="muted-copy">No recipients yet</em>}</div>
        <div className="privacy-header-row"><span className="privacy-field-label">Subject</span>{texts.subject ? pv.text('subject', texts.subject, pv.eff.hiddenSubjectRanges, true) : <em className="muted-copy">No subject yet</em>}</div>
        <span className="privacy-field-label">Message</span>{texts.body.trim() ? pv.text('body', texts.body, pv.eff.hiddenRanges) : <em className="muted-copy">No message yet</em>}
        {draft.attachments.length > 0 && <div className="attachments compose-privacy-atts">{draft.attachments.map((a, i) => { const hid = (pv.eff.hiddenAttachments || []).includes(i); const l = labelFor(pv.eff.hiddenAttachmentLabels?.[i], labels); return <button type="button" key={a.id || i} style={hid && l ? { '--label-color': l.color } : undefined} className={`${hid ? 'att-hidden' : ''} ${pv.pendAtts.includes(i) ? 'att-picked' : ''}`} onClick={() => pv.pickAttachment(i)}><Icon name={hid ? 'lock-fill' : 'file-earmark-text'} /><span>{hid ? mask(a.name) : a.name}</span></button>; })}</div>}
        <PrivacyBar labels={labels} label={hideLabel} setLabel={setHideLabel} onAddLabel={l => { onAddLabel?.(l); setHideLabel(l.id); }} mode={pv.mode} setMode={pv.setMode} pending={pv.pending} onClose={pv.close} onConfirm={pv.confirm} onHideAll={pv.hideAll} />
      </div> : <>
      <div className="subject-row"><label className="visually-hidden" htmlFor={`subject-${draft.id}`}>Subject</label><input id={`subject-${draft.id}`} value={draft.subject} maxLength={998} placeholder="Subject" onChange={event => update({ subject: event.target.value })} /></div>
      <div className={`editor-scroll ${draft.plainText ? 'plain-text-mode' : ''}`}><EditorContent editor={editor} /></div>
            </>}
      {!pv.mode && draft.attachments.length > 0 && <div className="composer-attachment-list" aria-label="Attachments">{draft.attachments.map(item => <div className={`composer-attachment ${item.status}`} key={item.id}><Icon name={item.type?.startsWith('image/') ? 'file-earmark-image' : 'file-earmark'} /><span><strong>{item.name}</strong><small>{formatBytes(item.size)} · {item.status === 'ready' ? 'Ready' : item.status === 'uploading' ? `Uploading ${item.progress || 0}%` : item.error || 'Re-add this file'}</small>{item.status === 'uploading' && <progress max="100" value={item.progress || 0} aria-label={`Upload progress for ${item.name}`} />}</span>{item.status === 'error' && <ComposeTool icon="arrow-clockwise" label={`Retry ${item.name}`} onClick={() => retryAttachment(item)} />}<ComposeTool icon="x" label={`Remove ${item.name}`} onClick={() => update({ attachments: draftRef.current.attachments.filter(file => file.id !== item.id) })} /></div>)}</div>}
      {draft.formatting && <div className="formatting-toolbar" role="toolbar" aria-label="Formatting options">
        <ComposeTool icon="arrow-counterclockwise" label="Undo" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()} /><ComposeTool icon="arrow-clockwise" label="Redo" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()} />
        <select aria-label="Font family" title="Font family" value={editor?.getAttributes('textStyle').fontFamily || FONTS[0].value} onChange={event => editor?.chain().focus().setFontFamily(event.target.value).run()}>{FONTS.map(font => <option value={font.value} key={font.label}>{font.label}</option>)}</select>
        <select aria-label="Text size" title="Text size" value={editor?.getAttributes('textStyle').fontSize || '14px'} onChange={event => editor?.chain().focus().setFontSize(event.target.value).run()}>{SIZES.map(size => <option value={size.value} key={size.label}>{size.label}</option>)}</select>
        <ComposeTool icon="type-bold" label="Bold (Ctrl+B)" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} /><ComposeTool icon="type-italic" label="Italic (Ctrl+I)" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} /><ComposeTool icon="type-underline" label="Underline (Ctrl+U)" active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
        <label className="colour-tool" title="Text colour"><Icon name="palette" /><span className="visually-hidden">Text colour</span><input type="color" aria-label="Text colour" value={editor?.getAttributes('textStyle').color || '#202124'} onChange={event => editor?.chain().focus().setColor(event.target.value).run()} /></label>
        <ComposeTool icon="text-left" label="Align left" active={editor?.isActive({ textAlign: 'left' })} onClick={() => editor?.chain().focus().setTextAlign('left').run()} /><ComposeTool icon="text-center" label="Align centre" active={editor?.isActive({ textAlign: 'center' })} onClick={() => editor?.chain().focus().setTextAlign('center').run()} /><ComposeTool icon="text-right" label="Align right" active={editor?.isActive({ textAlign: 'right' })} onClick={() => editor?.chain().focus().setTextAlign('right').run()} />
        <ComposeTool icon="list-ol" label="Numbered list" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} /><ComposeTool icon="list-ul" label="Bulleted list" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        <div className="composer-menu-wrap"><ComposeTool icon="three-dots-vertical" label="More formatting" active={menu === 'format'} onClick={() => setMenu(menu === 'format' ? '' : 'format')} />{menu === 'format' && <div className="composer-dropdown format-dropdown"><button onClick={() => editor?.chain().focus().toggleStrike().run()}><Icon name="type-strikethrough" /> Strikethrough</button><button onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Icon name="quote" /> Block quote</button><button onClick={() => editor?.chain().focus().sinkListItem('listItem').run()}><Icon name="text-indent-right" /> Increase indent</button><button onClick={() => editor?.chain().focus().liftListItem('listItem').run()}><Icon name="text-indent-left" /> Decrease indent</button><label><Icon name="highlighter" /> Highlight <input type="color" aria-label="Highlight colour" defaultValue="#fff176" onChange={event => editor?.chain().focus().setHighlight({ color: event.target.value }).run()} /></label><button onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}><Icon name="eraser" /> Remove formatting</button></div>}</div>
      </div>}
      {sendError && <div className="compose-error" role="alert">{sendError}<button onClick={() => setSendError('')} aria-label="Dismiss error"><Icon name="x" /></button></div>}
      <footer className="composer-actions">
        <div className="send-split"><button className="send-button" disabled={sending || !accounts.length} onClick={requestSend}>{sending ? 'Saving…' : 'Send demo'}</button><button className="send-caret" aria-label="Schedule send" title="Schedule send" disabled={sending} onClick={openSchedule}><Icon name="caret-down-fill" /></button></div>
        <ComposeTool icon="fonts" label="Toggle formatting toolbar" active={draft.formatting} onClick={() => update({ formatting: !draft.formatting })} />
        <ComposeTool icon="paperclip" label="Attach files (25 MB total)" onClick={() => fileRef.current?.click()} />
        <ComposeTool icon="link-45deg" label="Insert link (Ctrl+K)" onClick={openLink} />
        <div className="composer-menu-wrap"><ComposeTool icon="emoji-smile" label="Insert emoji" active={menu === 'emoji'} onClick={() => setMenu(menu === 'emoji' ? '' : 'emoji')} />{menu === 'emoji' && <div className="composer-dropdown emoji-picker"><input autoFocus aria-label="Search emoji" placeholder="Search emoji" value={emojiSearch} onChange={event => setEmojiSearch(event.target.value)} /><div>{emojiList.map(emoji => <button key={emoji.char} title={emoji.name} aria-label={`Insert ${emoji.char}`} onClick={() => { editor?.chain().focus().insertContent(emoji.char).run(); setMenu(''); }}>{emoji.char}</button>)}</div></div>}</div>
        <ComposeTool icon="google" label="Insert files using Google Drive" onClick={() => setDialog({ type: 'drive' })} />
        <ComposeTool icon="image" label="Insert photo" onClick={() => photoRef.current?.click()} />
        <ComposeTool icon={privStatus === 'green' ? 'unlock' : 'lock-fill'} label={pv.mode ? 'Back to editing' : 'Hide from AI'} active={!!pv.mode} className={`compose-ai-lock ${privStatus !== 'green' ? 'lock-' + privStatus : ''}`} onClick={() => pv.setMode(pv.mode ? null : 'lock')} />
        <ComposeTool icon="shield-lock" label="Confidential mode" onClick={() => setDialog({ type: 'confidential' })} />
        <ComposeTool icon="pen" label="Insert signature" onClick={() => setDialog({ type: 'signature' })} />
        <div className="composer-menu-wrap"><ComposeTool icon="three-dots-vertical" label="More options" active={menu === 'more'} onClick={() => setMenu(menu === 'more' ? '' : 'more')} />{menu === 'more' && <div className="composer-dropdown more-dropdown"><button onClick={() => { if (draft.plainText) { update({ plainText: false }); setMenu(''); } else setDialog({ type: 'plain-text' }); }}><Icon name="file-text" /> {draft.plainText ? 'Rich text mode' : 'Plain text mode'}</button><button onClick={printDraft}><Icon name="printer" /> Print</button><button onClick={() => { setDialog({ type: 'templates' }); setMenu(''); }}><Icon name="layout-text-window" /> Templates</button><button onClick={() => { onSettings({ ...settings, defaultExpanded: !settings.defaultExpanded }); setMenu(''); }}><Icon name="arrows-fullscreen" /> {settings.defaultExpanded ? '✓ ' : ''}Default to expanded</button><button onClick={() => { onSettings({ ...settings, failNextSend: !settings.failNextSend }); setMenu(''); }}><Icon name="exclamation-triangle" /> {settings.failNextSend ? '✓ ' : ''}Fail next demo send</button><label className="undo-setting">Undo Send<select value={settings.undoSeconds} onChange={event => onSettings({ ...settings, undoSeconds: Number(event.target.value) })}>{[5, 10, 20, 30].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label></div>}</div>
        <ComposeTool icon="trash" label="Discard draft" className="discard-button" onClick={() => setDialog({ type: 'discard' })} />
      </footer>
      <input ref={fileRef} type="file" multiple hidden onChange={event => addFiles(Array.from(event.target.files || []))} /><input ref={photoRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={event => addFiles(Array.from(event.target.files || []), true)} />
      <div className="composer-status" aria-live="polite"><span>{draft.saveState === 'saving' ? 'Saving…' : draft.saveState === 'error' ? 'Save failed — browser storage is full' : 'Draft saved in this browser'}</span><span>{account?.email}</span></div>
    </div>}

    {dialog?.type === 'link' && <ComposeDialog title="Insert link" onClose={() => setDialog(null)}><label>Text to display<input autoFocus value={linkForm.text} onChange={event => setLinkForm(form => ({ ...form, text: event.target.value }))} /></label><label>Web address<input type="url" value={linkForm.url} onChange={event => setLinkForm(form => ({ ...form, url: event.target.value }))} /></label><div className="compose-dialog-actions">{editor?.isActive('link') && <button className="text-button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setDialog(null); }}>Remove link</button>}<button onClick={() => setDialog(null)}>Cancel</button><button className="dialog-primary" onClick={applyLink}>Insert link</button></div></ComposeDialog>}
    {dialog?.type === 'image-settings' && <ComposeDialog title="Image settings" onClose={() => setDialog(null)}><label>Alternative text<input autoFocus value={imageForm.alt} placeholder="Describe this image" onChange={event => setImageForm(form => ({ ...form, alt: event.target.value }))} /></label><label>Display width in pixels<input type="number" min="20" max="1200" value={imageForm.width} placeholder="Original width" onChange={event => setImageForm(form => ({ ...form, width: event.target.value }))} /></label><div className="compose-dialog-actions"><button className="text-button" onClick={() => { editor?.chain().focus().deleteSelection().run(); setDialog(null); }}>Remove image</button><button onClick={() => setDialog(null)}>Cancel</button><button className="dialog-primary" onClick={() => { editor?.chain().focus().updateAttributes('image', { alt: imageForm.alt, width: imageForm.width ? Number(imageForm.width) : null }).run(); setDialog(null); }}>Apply</button></div></ComposeDialog>}
    {dialog?.type === 'empty-warning' && <ComposeDialog title="Send this message?" onClose={() => setDialog(null)}><p>{!dialog.draft.subject.trim() && !htmlToText(dialog.draft.bodyHtml).trim() ? 'This message has no subject and no body.' : !dialog.draft.subject.trim() ? 'This message has no subject.' : 'This message has no body.'}</p><p>You can send the demo message anyway.</p><div className="compose-dialog-actions"><button onClick={() => setDialog(null)}>Keep editing</button><button className="dialog-primary" onClick={() => finishSend(dialog.draft)}>Send anyway</button></div></ComposeDialog>}
    {dialog?.type === 'confirm-send' && <ComposeDialog title="Send demo message?" onClose={() => setDialog(null)}><p>You used the keyboard send shortcut. No real email will be delivered.</p><div className="compose-dialog-actions"><button onClick={() => setDialog(null)}>Cancel</button><button className="dialog-primary" onClick={requestSend}>Send demo</button></div></ComposeDialog>}
    {dialog?.type === 'schedule' && <ComposeDialog title="Schedule demo send" onClose={() => setDialog(null)}><p className="dialog-note">Stored in this browser and processed when Cypht is open. A real provider scheduler is not connected.</p>{suggestedTimes().map(item => <button className="schedule-choice" key={item.label} onClick={() => finishSend(dialog.draft, item.date.toISOString())}><strong>{item.label}</strong><span>{item.date.toLocaleString()}</span></button>)}<label>Pick date and time<input type="datetime-local" min={localInputDate(new Date())} value={scheduleDate} onChange={event => setScheduleDate(event.target.value)} /></label><p className="timezone-copy">Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p><div className="compose-dialog-actions"><button onClick={() => setDialog(null)}>Cancel</button><button className="dialog-primary" disabled={!scheduleDate || new Date(scheduleDate) <= new Date()} onClick={() => finishSend(dialog.draft, new Date(scheduleDate).toISOString())}>Schedule demo send</button></div></ComposeDialog>}
    {dialog?.type === 'drive' && <ComposeDialog title="Google Drive" onClose={() => setDialog(null)}><Icon name="google" /><p>Google Drive is not connected to this preview. No files are shown or inserted.</p><p className="dialog-note">A real authenticated Drive connection is required before recipients’ sharing permissions can be checked.</p><div className="compose-dialog-actions"><button className="dialog-primary" onClick={() => setDialog(null)}>Got it</button></div></ComposeDialog>}
    {dialog?.type === 'confidential' && <ComposeDialog title="Confidential mode" onClose={() => setDialog(null)}><Icon name="lock" /><p>Confidential sending is unavailable because this preview has no secure-message provider.</p><p className="dialog-note">Expiration and SMS passcode settings cannot be applied to an ordinary email. Access restrictions also cannot prevent screenshots.</p><div className="compose-dialog-actions"><button className="dialog-primary" onClick={() => setDialog(null)}>Keep confidential mode off</button></div></ComposeDialog>}
    {dialog?.type === 'discard' && <ComposeDialog title="Discard this draft?" onClose={() => setDialog(null)}><p>This removes the draft and its temporary uploads. Closing the composer would save it instead.</p><div className="compose-dialog-actions"><button onClick={() => setDialog(null)}>Keep editing</button><button className="dialog-danger" onClick={() => onDiscard(draftRef.current)}>Discard draft</button></div></ComposeDialog>}
    {dialog?.type === 'plain-text' && <ComposeDialog title="Switch to plain text?" onClose={() => setDialog(null)}><p>This removes rich formatting, links, and images while preserving the message wording.</p><div className="compose-dialog-actions"><button onClick={() => setDialog(null)}>Keep rich text</button><button className="dialog-primary" onClick={switchPlainText}>Switch to plain text</button></div></ComposeDialog>}
    {dialog?.type === 'signature' && <ComposeDialog title="Insert signature" onClose={() => setDialog(null)}><label>Saved signature<select aria-label="Saved signature" value={draft.signatureId || ''} onChange={event => { const signature = signatures.find(item => item.id === event.target.value); if (event.target.value) applySignature(signature); else applySignature(null); }}><option value="">No signature</option>{signatures.map(signature => <option value={signature.id} key={signature.id}>{signature.name}</option>)}</select></label><button className="text-button" onClick={() => setDialog({ type: 'manage-signatures' })}>Manage signatures</button><div className="compose-dialog-actions"><button onClick={() => setDialog(null)}>Cancel</button></div></ComposeDialog>}
    {dialog?.type === 'manage-signatures' && <ComposeDialog title="Manage signatures" onClose={() => setDialog(null)}><div className="signature-list">{signatures.map(signature => <div key={signature.id}><strong>{signature.name}</strong><button aria-label={`Delete signature ${signature.name}`} onClick={() => onSettings({ ...settings, signatures: signatures.filter(item => item.id !== signature.id) })}><Icon name="trash" /></button></div>)}</div><label>Name<input value={signatureDraft.name} placeholder="Work signature" onChange={event => setSignatureDraft(form => ({ ...form, name: event.target.value }))} /></label><label>Signature text<textarea rows="5" value={signatureDraft.text} placeholder={'Best regards,\nYour name'} onChange={event => setSignatureDraft(form => ({ ...form, text: event.target.value }))} /></label><p className="dialog-note">Plain text signatures support line breaks. Rich links and images can be pasted into the message after insertion.</p><div className="compose-dialog-actions"><button onClick={() => setDialog({ type: 'signature' })}>Back</button><button className="dialog-primary" disabled={!signatureDraft.name.trim() || !signatureDraft.text.trim()} onClick={() => { const signature = { id: crypto.randomUUID(), name: signatureDraft.name.trim(), html: textToHtml(signatureDraft.text) }; onSettings({ ...settings, signatures: [...signatures, signature] }); setSignatureDraft({ id: '', name: '', text: '' }); setDialog({ type: 'signature' }); }}>Save signature</button></div></ComposeDialog>}
    {dialog?.type === 'templates' && <ComposeDialog title="Message templates" onClose={() => setDialog(null)}>{templates.length ? templates.map(template => <div className="template-row" key={template.id}><button onClick={() => insertTemplate(template)}>{template.name}</button><ComposeTool icon="trash" label={`Delete template ${template.name}`} onClick={() => onSettings({ ...settings, templates: templates.filter(item => item.id !== template.id) })} /></div>) : <p>No saved templates yet.</p>}<label>Save current message as<input value={templateName} placeholder="Template name" onChange={event => setTemplateName(event.target.value)} /></label><div className="compose-dialog-actions"><button onClick={() => setDialog(null)}>Close</button><button className="dialog-primary" disabled={!templateName.trim()} onClick={() => { onSettings({ ...settings, templates: [...templates, { id: crypto.randomUUID(), name: templateName.trim(), html: cleanHtml(editor.getHTML()) }] }); setTemplateName(''); }}>Save template</button></div></ComposeDialog>}
  </section>;
}
