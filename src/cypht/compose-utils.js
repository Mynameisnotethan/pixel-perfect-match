import DOMPurify from 'dompurify';

export const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function normalizeEmail(value = '') {
  return value.trim().replace(/^<|>$/g, '').replace(/[;,]$/, '').toLowerCase();
}

export function validEmail(value) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

export function recipient(email, name = '') {
  return { email: normalizeEmail(email), name: name || normalizeEmail(email).split('@')[0] };
}

export function parseRecipients(value = '') {
  return value.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
}

export function addRecipient(list, value, name = '') {
  const email = normalizeEmail(value);
  if (!validEmail(email)) return { list, error: 'Enter a valid email address.' };
  if (list.some(item => normalizeEmail(item.email) === email)) return { list, error: 'That recipient is already in this field.' };
  return { list: [...list, recipient(email, name)], error: '' };
}

export function duplicateRecipients(groups) {
  const seen = new Set();
  const duplicates = new Set();
  ['to', 'cc', 'bcc'].forEach(field => (groups[field] || []).forEach(item => {
    const email = normalizeEmail(item.email);
    if (seen.has(email)) duplicates.add(email);
    seen.add(email);
  }));
  return [...duplicates];
}

export function escapeHtml(value = '') {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function textToHtml(value = '') {
  return value.split(/\n{2,}/).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('');
}

export function cleanHtml(value = '') {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'font'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'style', 'class', 'width', 'height', 'data-signature'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data:image\/(?:png|gif|jpe?g|webp);base64):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}

export function htmlToText(value = '') {
  if (typeof document === 'undefined') return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const container = document.createElement('div');
  container.innerHTML = cleanHtml(value);
  container.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  container.querySelectorAll('p,div,li,blockquote').forEach(element => element.append('\n'));
  return (container.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeDraft(draft, account) {
  const groups = draft.recipients || {};
  const to = groups.to || parseRecipients(draft.to).map(email => recipient(email));
  const cc = groups.cc || parseRecipients(draft.cc).map(email => recipient(email));
  const bcc = groups.bcc || parseRecipients(draft.bcc).map(email => recipient(email));
  const bodyHtml = draft.bodyHtml || textToHtml(draft.body || '');
  return {
    ...draft,
    id: draft.id || crypto.randomUUID(),
    account: draft.account || account || '',
    recipients: { to, cc, bcc },
    bodyHtml: cleanHtml(bodyHtml),
    body: htmlToText(bodyHtml),
    plainText: !!draft.plainText,
    attachments: (draft.attachments || []).map(item => ({ status: item.content ? 'ready' : 'metadata', progress: item.content ? 100 : 0, ...item })),
    formatting: draft.formatting !== false,
    minimized: !!draft.minimized,
    expanded: !!draft.expanded,
    updatedAt: draft.updatedAt || new Date().toISOString(),
  };
}

export function draftMessage(draft, account, folder = 'drafts') {
  const bodyHtml = cleanHtml(draft.bodyHtml || textToHtml(draft.body || ''));
  return {
    ...draft,
    sender: 'Me',
    email: account?.email || '',
    to: (draft.recipients?.to || []).map(item => item.email).join(', '),
    cc: (draft.recipients?.cc || []).map(item => item.email).join(', '),
    bcc: undefined,
    recipients: { to: draft.recipients?.to || [], cc: draft.recipients?.cc || [], bcc: folder === 'drafts' ? draft.recipients?.bcc || [] : [] },
    bodyHtml,
    body: htmlToText(bodyHtml),
    folder,
    read: true,
    flagged: false,
    date: new Date().toISOString(),
    subject: draft.subject || '(No subject)',
    minimized: false,
    expanded: false,
  };
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isSafeLink(value = '') {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
}
