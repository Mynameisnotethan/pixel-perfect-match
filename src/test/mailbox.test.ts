import { describe, expect, it } from 'vitest';
// @ts-expect-error JS module
import { upsertMailbox, setStatus, removeMailbox } from '../cypht/mailbox-demo.js';
// @ts-expect-error JS module
import { upsertMailbox as upsertShared } from '../../connectors/mail.mjs';
// @ts-expect-error JS module
import { buildAuthUrl, createPkce, stateMatches } from '../../connectors/oauth.mjs';

describe('mailbox connections', () => {
  it('connecting the same mailbox again updates it instead of adding a second one', () => {
    let list = upsertMailbox([], { provider: 'google', email: 'Me@Gmail.com', status: 'connected' });
    list = setStatus(list, list[0].id, 'reconnect');
    list = upsertMailbox(list, { provider: 'google', email: 'me@gmail.com', status: 'connected' });
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('connected');
  });
  it('supports multiple mailboxes and disconnecting one', () => {
    let list = upsertMailbox([], { provider: 'google', email: 'a@gmail.com', status: 'connected' });
    list = upsertMailbox(list, { provider: 'microsoft', email: 'a@gmail.com', status: 'connected' });
    expect(list).toHaveLength(2);
    expect(removeMailbox(list, list[0].id)).toHaveLength(1);
  });
  it('shared server/desktop upsert also dedupes by provider + address', () => {
    const list = upsertShared(upsertShared([], { id: 'x', provider: 'microsoft', email: 'b@outlook.com' }), { id: 'y', provider: 'microsoft', email: 'B@outlook.com', status: 'reconnect' });
    expect(list).toEqual([{ id: 'x', provider: 'microsoft', email: 'B@outlook.com', status: 'reconnect' }]);
  });
});

describe('OAuth', () => {
  it('builds a PKCE auth URL with only mail identify/read/send scopes', async () => {
    const { challenge, state } = await createPkce();
    const url = new URL(buildAuthUrl('google', { clientId: 'cid', redirectUri: 'http://127.0.0.1:5000/callback', challenge, state }));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
    const ms = new URL(buildAuthUrl('microsoft', { clientId: 'cid', redirectUri: 'r', challenge, state }));
    expect(ms.searchParams.get('scope')).toBe('openid email offline_access User.Read Mail.Read Mail.Send');
  });
  it('rejects a mismatched state', () => {
    expect(stateMatches('abc', 'abc')).toBe(true);
    expect(stateMatches('abc', 'abd')).toBe(false);
    expect(stateMatches('abc', null)).toBe(false);
  });
});
