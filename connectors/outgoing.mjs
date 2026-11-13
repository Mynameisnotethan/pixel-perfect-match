// Shared validation for real outgoing mail. Keeping this at the transport boundary
// prevents the browser from reporting success while fields are silently discarded.
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const MAX_BODY = 500_000;
const MAX_HTML = 2_000_000;
const MAX_ATTACHMENTS = 25 * 1024 * 1024;
const invalid = () => Object.assign(new Error('invalid_message'), { status: 400 });

function addresses(value) {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string' || value.length > 20_000) throw invalid();
  const list = value.split(',').map(item => item.trim()).filter(Boolean);
  if (list.length > 100 || list.some(item => !EMAIL.test(item))) throw invalid();
  return list;
}

export function normalizeOutgoing(input = {}) {
  const to = addresses(input.to);
  const cc = addresses(input.cc);
  const bcc = addresses(input.bcc);
  if (!to.length && !cc.length && !bcc.length) throw invalid();
  const subject = input.subject ?? '';
  const body = input.body ?? '';
  const html = input.html ?? '';
  if (typeof subject !== 'string' || subject.length > 998 || /[\r\n]/.test(subject)) throw invalid();
  if (typeof body !== 'string' || body.length > MAX_BODY || typeof html !== 'string' || html.length > MAX_HTML) throw invalid();
  if (input.attachments !== undefined && !Array.isArray(input.attachments)) throw invalid();
  let total = 0;
  const attachments = (input.attachments || []).map(item => {
    const match = typeof item?.content === 'string' && item.content.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?;base64,([a-z0-9+/=\s]+)$/i);
    if (!match || !item.name || typeof item.name !== 'string' || /[\r\n]/.test(item.name)) throw invalid();
    const content = match[2].replace(/\s/g, '');
    const size = Math.floor(content.length * 3 / 4) - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0);
    total += size;
    if (size > MAX_ATTACHMENTS || total > MAX_ATTACHMENTS) throw invalid();
    return {
      name: item.name.slice(0, 255),
      contentType: String(item.type || match[1] || 'application/octet-stream').slice(0, 150),
      size,
      content,
    };
  });
  return {
    to: to.join(', '),
    cc: cc.join(', '),
    bcc: bcc.join(', '),
    subject,
    body,
    html,
    attachments,
  };
}

export const graphRecipients = value => addresses(value).map(address => ({ emailAddress: { address } }));
export const mimeAttachments = attachments => attachments.map(item => ({
  filename: item.name,
  contentType: item.contentType,
  content: Buffer.from(item.content, 'base64'),
}));
export const graphAttachments = attachments => attachments.map(item => ({
  '@odata.type': '#microsoft.graph.fileAttachment',
  name: item.name,
  contentType: item.contentType,
  contentBytes: item.content,
  size: item.size,
}));
