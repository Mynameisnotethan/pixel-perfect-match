import { describe, it, expect } from 'vitest';
import { gmailAttachments } from '../../connectors/mail.mjs';
import { imapAttachments } from '../../connectors/imap.mjs';
import { inboxToMessages } from '../../connectors/ai-feed.mjs';

describe('incoming attachments', () => {
  it('finds Gmail file parts in nested payloads', () => {
    const payload = { parts: [{ mimeType: 'text/plain', body: {} }, { parts: [{ filename: 'invoice.pdf', mimeType: 'application/pdf', body: { attachmentId: 'A1', size: 900 } }] }] };
    expect(gmailAttachments(payload)).toEqual([{ id: 'A1', name: 'invoice.pdf', type: 'application/pdf', size: 900 }]);
  });
  it('finds IMAP attachment parts', () => {
    const tree = { childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'image/png', disposition: 'attachment', dispositionParameters: { filename: 'photo.png' }, size: 50 }] };
    expect(imapAttachments(tree)).toEqual([{ id: '2', name: 'photo.png', type: 'image/png', size: 50 }]);
  });
  it('keeps attachments when synced mail becomes Lockbox messages', () => {
    const [m] = inboxToMessages({ id: 'g1' }, [{ id: 'm9', from: 'a@b.co', subject: 's', attachments: [{ id: 'A1', name: 'invoice.pdf', type: 'application/pdf', size: 900 }] }]);
    expect(m.attachments).toEqual([{ name: 'invoice.pdf', type: 'application/pdf', size: 900, remote: { message: 'm9', id: 'A1' } }]);
  });
});
