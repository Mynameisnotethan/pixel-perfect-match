#!/usr/bin/env node
// Safe live MCP permission check. Keys come only from environment variables and are never printed.
// The probe calls use missing/impossible draft ids, so they cannot create or send real email.
import { pathToFileURL } from 'node:url';

export const MCP_LEVELS = [
  {
    label: 'read-only', env: 'LOCKBOX_READ_KEY',
    expected: ['list_messages', 'get_message'],
    probes: [{ name: 'create_draft', arguments: {}, match: /not allowed/i }],
  },
  {
    label: 'draft-enabled', env: 'LOCKBOX_DRAFT_KEY',
    expected: ['list_messages', 'get_message', 'create_draft', 'update_draft'],
    probes: [
      { name: 'update_draft', arguments: { draft_id: 'drf_mcp_permission_probe' }, match: /draft not found/i },
      { name: 'send_draft', arguments: { draft_id: 'drf_mcp_permission_probe' }, match: /not allowed/i },
    ],
  },
  {
    label: 'send-enabled', env: 'LOCKBOX_SEND_KEY',
    expected: ['list_messages', 'get_message', 'create_draft', 'update_draft', 'send_draft'],
    probes: [{ name: 'send_draft', arguments: { draft_id: 'drf_mcp_permission_probe' }, match: /draft not found/i }],
  },
];

async function rpc(url, key, message, session = null) {
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (session?.id) headers['Mcp-Session-Id'] = session.id;
  if (session?.protocol) headers['MCP-Protocol-Version'] = session.protocol;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(20_000) });
  const id = response.headers.get('mcp-session-id');
  if (id) session = { ...(session || {}), id };
  if (response.status === 202) return { body: null, session };
  const text = await response.text();
  let body = null;
  try {
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      body = data ? JSON.parse(data) : null;
    } else body = text ? JSON.parse(text) : null;
  } catch { throw new Error(`MCP returned a non-JSON response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(`MCP request failed (HTTP ${response.status}: ${body?.error || body?.error?.message || 'request rejected'}).`);
  if (body?.error) throw new Error(`MCP ${message.method} failed: ${body.error.message || body.error.code}.`);
  return { body, session };
}

export async function probeMcpLevel(url, key, level) {
  let session = { id: null, protocol: null };
  const initialized = await rpc(url, key, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lockbox-permission-probe', version: '1.0.0' } },
  }, session);
  session = initialized.session;
  const protocol = initialized.body?.result?.protocolVersion;
  if (!protocol) throw new Error('The initialize response did not negotiate a protocol version.');
  session.protocol = protocol;
  await rpc(url, key, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const listed = await rpc(url, key, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session);
  const tools = listed.body?.result?.tools?.map(tool => tool.name) || [];
  const missing = level.expected.filter(name => !tools.includes(name));
  const unexpected = tools.filter(name => !level.expected.includes(name));
  const calls = [];
  for (const probe of level.probes) {
    const called = await rpc(url, key, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: probe.name, arguments: probe.arguments } }, session);
    const result = called.body?.result;
    const text = result?.content?.filter(item => item.type === 'text').map(item => item.text).join(' ') || '';
    calls.push({ tool: probe.name, passed: !!result?.isError && probe.match.test(text) });
  }
  return {
    label: level.label, protocol, session: session.id ? 'negotiated' : 'not used (stateless server)',
    server: initialized.body?.result?.serverInfo?.version || 'unreported', tools, missing, unexpected, calls,
    passed: !missing.length && !unexpected.length && calls.every(call => call.passed),
  };
}

export async function runMcpDiagnostic({ url = process.env.LOCKBOX_MCP_URL, keys = process.env } = {}) {
  if (!url) throw new Error('Set LOCKBOX_MCP_URL to the full MCP address.');
  const results = [];
  for (const level of MCP_LEVELS) {
    const key = keys[level.env];
    if (!key) throw new Error(`Set ${level.env} for the ${level.label} test key. Keys are never printed.`);
    results.push(await probeMcpLevel(url, key, level));
  }
  return results;
}

async function main() {
  try {
    const results = await runMcpDiagnostic();
    for (const result of results) {
      console.log(`\n${result.label}: ${result.passed ? 'PASS' : 'FAIL'}`);
      console.log(`  Protocol: ${result.protocol}; session: ${result.session}; server version: ${result.server}`);
      console.log(`  Tools: ${result.tools.join(', ') || '(none)'}`);
      if (result.missing.length) console.log(`  Missing: ${result.missing.join(', ')}`);
      if (result.unexpected.length) console.log(`  Unexpected: ${result.unexpected.join(', ')}`);
      for (const call of result.calls) console.log(`  Call permission ${call.tool}: ${call.passed ? 'PASS' : 'FAIL'}`);
    }
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } catch (error) {
    // Deliberately do not print request headers, environment variables, or response bodies.
    console.error(`MCP diagnostic failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
