import { describe, it, expect } from 'vitest';
// @ts-expect-error JS module
import { gmailAttachments } from '../../connectors/mail.mjs';
// @ts-expect-error JS module
import { imapAttachments } from '../../connectors/imap.mjs';
// @ts-expect-error JS module
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

// @ts-expect-error JS module
import { forwardAttachments } from '../cypht/mailbox-live.js';
describe('forwarding attachments', () => {
  it('copies local files and queues server files for fetching', () => {
    const out = forwardAttachments({ id: 'm1', attachments: [{ name: 'a.txt', content: 'data:text/plain;base64,aGk=' }, { name: 'b.pdf', remote: { message: 'x', id: 'y' } }] });
    expect(out[0]).toMatchObject({ name: 'a.txt', status: 'ready', content: 'data:text/plain;base64,aGk=' });
    expect(out[1]).toMatchObject({ name: 'b.pdf', status: 'uploading', remote: { message: 'x', id: 'y' } });
  });
});
