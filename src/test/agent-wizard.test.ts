// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { mcpUrlFrom, tryPrompts, evidence, TEST_PROMPT, grokSample, saveProgress, loadProgress } from '../cypht/agent-wizard.js';
import { createKeyStore } from '../../connectors/keystore.mjs';

describe('Connect an Agent wizard', () => {
  it('builds the MCP URL from the public URL or API base', () => {
    expect(mcpUrlFrom('https://mail.example.org/')).toBe('https://mail.example.org/api/ai/v1/mcp');
    expect(mcpUrlFrom('https://mail.example.org/api/ai/v1')).toBe('https://mail.example.org/api/ai/v1/mcp');
    expect(mcpUrlFrom('')).toBe('');
  });
  it('only offers send and schedule prompts when the key can send', () => {
    expect(tryPrompts({ mailboxes: 'all', read: true }).map((p: any) => p.id)).toEqual(['list']);
    expect(tryPrompts({ mailboxes: 'all', read: true, drafts: true }).map((p: any) => p.id)).toEqual(['list', 'draft']);
    expect(tryPrompts({ mailboxes: 'all', read: true, send: true }).map((p: any) => p.id)).toEqual(['list']); // send needs drafts
    expect(tryPrompts({ mailboxes: 'all', read: true, drafts: true, send: true }).map((p: any) => p.id)).toEqual(['list', 'draft', 'send', 'schedule']);
  });
  it('marks verification only from activity the server recorded after the wizard opened', () => {
    const since = Date.parse('2026-11-15T00:00:00Z');
    expect(evidence({ reachable: null, key: { lastUsedAt: '2026-11-14T00:00:00Z', lastToolCallAt: null }, since })).toEqual({ reachable: 'unknown', authenticated: 'unknown', toolCalled: 'unknown' });
    expect(evidence({ reachable: true, key: { lastUsedAt: '2026-11-15T01:00:00Z', lastToolCallAt: '2026-11-15T01:00:01Z' }, since })).toEqual({ reachable: 'ok', authenticated: 'ok', toolCalled: 'ok' });
  });
  it('never puts a key into prompts, samples or saved progress', () => {
    expect(TEST_PROMPT).toContain('get_access');
    expect(grokSample('https://x.test/api/ai/v1/mcp')).not.toMatch(/lbx_[A-Za-z0-9]/);
    saveProgress({ step: 2, secret: 'lbx_secretsecretsecretsecret' });
    expect(JSON.stringify(loadProgress())).not.toContain('lbx_');
  });
  it('records successful tool calls on the key', async () => {
    let db: any = {}; const ks = createKeyStore({ read: async () => db, write: async (d: any) => { db = d; } });
    const k = await ks.create('u', 'ChatGPT');
    await ks.noteTool('u', k.id, 'get_access');
    const [rec] = await ks.list('u');
    expect(rec.lastToolName).toBe('get_access'); expect(rec.lastToolCallAt).toBeTruthy();
  });
});
