import { describe, it, expect } from 'vitest';
import { freshDefaults, confirmsLock } from '../cypht/privacy.js';
describe('hide-by-default', () => {
  it('new users hide everything', () => {
    expect(freshDefaults()).toEqual({ subject: true, sender: true, email: true, body: true, attachments: true, sent: { subject: true, to: true, body: true, attachments: true } });
  });
  it('requires typing exactly Lock', () => {
    expect(confirmsLock('Lock')).toBe(true);
    expect(confirmsLock('lock')).toBe(false);
    expect(confirmsLock('Lock ')).toBe(false);
  });
});
