// Full plain-text bodies for received mail. Provider "snippets" are short previews (about 200–300 characters),
// so the reader needs the real body. HTML-only emails are turned into readable text; nothing is truncated
// below MAX_TEXT, which only guards against pathological messages.
export const MAX_TEXT = 1_000_000;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function htmlToText(html = '') {
  return String(html)
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote|table|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => { const t = label.replace(/<[^>]+>/g, '').trim(); return t && t !== href ? `${t} (${href})` : href; })
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t\u00a0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const clampText = t => String(t || '').replace(/\r\n/g, '\n').slice(0, MAX_TEXT);
const b64url = v => Buffer.from(String(v || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
/** Gmail payload tree → full text (text/plain preferred, else HTML converted). Attachments are skipped. */
export function gmailText(payload) {
  const parts = []; const walk = p => { if (!p) return; if (!p.filename && p.body?.data) parts.push(p); (p.parts || []).forEach(walk); }; walk(payload);
  const plain = parts.find(p => p.mimeType === 'text/plain'); if (plain) return clampText(b64url(plain.body.data));
  const html = parts.find(p => p.mimeType === 'text/html'); return html ? clampText(htmlToText(b64url(html.body.data))) : '';
}
/** IMAP bodyStructure → part numbers of the readable text part. */
export function imapTextPart(node) {
  const found = { plain: null, html: null };
  const walk = n => { if (!n) return; const t = String(n.type || '').toLowerCase(); if (n.disposition !== 'attachment') { if (t === 'text/plain' && !found.plain) found.plain = n.part || '1'; if (t === 'text/html' && !found.html) found.html = n.part || '1'; } (n.childNodes || []).forEach(walk); };
  walk(node); return found.plain ? { part: found.plain, html: false } : found.html ? { part: found.html, html: true } : null;
}
