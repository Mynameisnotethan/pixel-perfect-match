// @ts-nocheck
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { createAiRoutes, buildFeed, createLimiter } from '../../connectors/ai-feed.mjs';
import { createKeyStore } from '../../connectors/keystore.mjs';
import { MCP_LEVELS, probeMcpLevel } from '../../scripts/check-mcp-tools.mjs';

const drafts = {
  update: async () => { throw Object.assign(new Error('Draft not found.'), { status: 404 }); },
  send: async () => { throw Object.assign(new Error('Draft not found.'), { status: 404 }); },
};

describe('authenticated MCP diagnostic', () => {
  it('follows protocol/session headers and checks all three permission levels without mail side effects', async () => {
    let db = {};
    const keys = createKeyStore({ read: async () => db, write: async value => { db = value; } });
    const made = [];
    for (const perms of [
      { read: true, drafts: false, send: false },
      { read: true, drafts: true, send: false },
      { read: true, drafts: true, send: true },
    ]) {
      const key = await keys.create('owner', 'diagnostic');
      await keys.setPerms('owner', key.id, perms);
      made.push(key.key);
    }
    const routes = createAiRoutes({
      inspectKey: key => keys.inspect(key), verifyKey: key => keys.verify(key), drafts, limit: createLimiter(100),
      feedFor: async () => buildFeed({ boxes: [], fetchInbox: async () => [], privacy: { rules: {} } }),
    });
    const followups = [];
    const server = http.createServer(async (req, res) => {
      res.setHeader('Mcp-Session-Id', 'diagnostic-session');
      if (req.headers['mcp-session-id']) followups.push({ session: req.headers['mcp-session-id'], protocol: req.headers['mcp-protocol-version'] });
      if (!(await routes(req, res, new URL(req.url, 'http://localhost')))) res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/ai/v1/mcp`;
    try {
      for (const [index, level] of MCP_LEVELS.entries()) {
        const result = await probeMcpLevel(url, made[index], level);
        expect(result.passed).toBe(true);
        expect(result.tools).toEqual(level.expected);
        expect(result.protocol).toBe('2025-06-18');
        expect(result.session).toBe('negotiated');
      }
      expect(followups.length).toBeGreaterThan(0);
      expect(followups.every(request => request.session === 'diagnostic-session' && request.protocol === '2025-06-18')).toBe(true);
    } finally { server.close(); }
  });
});
