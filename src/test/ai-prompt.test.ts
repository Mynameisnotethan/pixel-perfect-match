// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { buildChatGptPrompt } from '@/cypht/ai-prompt.js';
import { aiOpenApi } from '../../connectors/ai-openapi.mjs';
import { createAiRoutes } from '../../connectors/ai-feed.mjs';

describe('ChatGPT prompt', () => {
  const p = buildChatGptPrompt({ endpoint: 'https://mail.example.com/api/ai/v1', keyName: 'GPT' });
  it('includes the schema URL and key name', () => { expect(p).toContain('https://mail.example.com/api/ai/v1/openapi.json'); expect(p).toContain('"GPT"'); });
  it('never includes a key', () => expect(p).not.toMatch(/lbx_[0-9a-f]{8}/));
  it('warns for desktop addresses', () => expect(buildChatGptPrompt({ endpoint: 'http://127.0.0.1:47615/api/ai/v1', keyName: 'x' })).toContain('only works on my own computer'));
});

describe('openapi route', () => {
  it('is served without a key and holds no mail', async () => {
    let body = '', status = 0;
    const routes = createAiRoutes({ verifyKey: async () => null, feedFor: async () => [{ id: 'secret' }] });
    const res: any = { writeHead: (s: number) => { status = s; }, end: (b: string) => { body = b; } };
    await routes({ method: 'GET', headers: { host: 'mail.example.com', 'x-forwarded-proto': 'https' } } as any, res, new URL('http://x/api/ai/v1/openapi.json'));
    expect(status).toBe(200);
    expect(JSON.parse(body).servers[0].url).toBe('https://mail.example.com/api/ai/v1');
    expect(body).not.toContain('secret"');
    expect(aiOpenApi('u').paths['/messages'].get.operationId).toBe('listMessages');
  });
});
