import { describe, it, expect } from 'vitest';
// @ts-expect-error JS module
import { freshDefaults, normalizeDefaults, confirmsLock } from '../cypht/privacy.js';
describe('hide-by-default', () => {
  it('new users hide everything', () => {
    expect(freshDefaults()).toEqual({ subject: true, sender: true, email: true, body: true, attachments: true, sent: { subject: true, to: true, body: true, attachments: true } });
  });
  it('missing fields in older saves stay hidden by default', () => {
    expect(normalizeDefaults({})).toEqual(freshDefaults());
    expect(normalizeDefaults(null)).toEqual(freshDefaults());
    expect(normalizeDefaults({ body: false, sent: { subject: false } })).toEqual({ ...freshDefaults(), body: false, sent: { ...freshDefaults().sent, subject: false } });
  });
  it('requires typing exactly Lock', () => {
    expect(confirmsLock('Lock')).toBe(true);
    expect(confirmsLock('lock')).toBe(false);
    expect(confirmsLock('Lock ')).toBe(false);
  });
});
