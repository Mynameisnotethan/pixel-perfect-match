#!/usr/bin/env node
// Safe live MCP permission check. Keys come only from environment variables and are never printed.
// The probe calls use missing/impossible draft ids, so they cannot create or send real email.
import { pathToFileURL } from 'node:url';

export const MCP_LEVELS = [
  {
    label: 'read-only', env: 'LOCKBOX_READ_KEY',
    expected: ['list_messages', 'get_message', 'get_access'],
    probes: [{ name: 'create_draft', arguments: {}, match: /not allowed/i }],
  },
  {
    label: 'draft-enabled', env: 'LOCKBOX_DRAFT_KEY',
    expected: ['list_messages', 'get_message', 'create_draft', 'update_draft', 'list_drafts', 'get_draft', 'get_access'],
    probes: [
      { name: 'update_draft', arguments: { draft_id: 'drf_mcp_permission_probe' }, match: /draft not found/i },
      { name: 'send_draft', arguments: { draft_id: 'drf_mcp_permission_probe' }, match: /not allowed/i },
    ],
  },
  {
    label: 'send-enabled', env: 'LOCKBOX_SEND_KEY',
    expected: ['list_messages', 'get_message', 'create_draft', 'update_draft', 'list_drafts', 'get_draft', 'send_draft', 'request_send_approval', 'schedule_send', 'cancel_scheduled_send', 'get_access'],
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

async function openSession(url, key) {
  const init = await rpc(url, key, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lockbox-access-check', version: '1.0.0' } } });
  const session = { ...init.session, protocol: init.body?.result?.protocolVersion };
  await rpc(url, key, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  let n = 10;
  const call = async (name, args = {}) => {
    const r = (await rpc(url, key, { jsonrpc: '2.0', id: n++, method: 'tools/call', params: { name, arguments: args } }, session)).body?.result;
    const out = r?.structuredContent || {};
    if (r?.isError) throw new Error(`${name}: ${out.error?.code || 'error'} ${out.error?.message || r?.content?.[0]?.text || ''}`.trim());
    return out;
  };
  return { server: init.body?.result?.serverInfo?.version || 'unreported', call };
}

/** Which key this connection uses and what it may do (no secrets, no email content). */
export async function checkAccess(url, key) {
  const s = await openSession(url, key);
  return { server: s.server, access: await s.call('get_access') };
}

/**
 * Creates a self-addressed draft, schedules it an hour ahead, confirms it is queued, then cancels it.
 * Never sends: the cancel runs before the send time, and nothing is sent when it is not queued.
 */
export async function scheduleTest(url, key, { mailbox, to, now = Date.now() }) {
  const s = await openSession(url, key);
  const d = await s.call('create_draft', { mailbox, to, subject: 'Lockbox scheduling check (will be cancelled)', body: 'Automatic Lockbox check. This email is cancelled before it is sent.' });
  const sendAt = new Date(now + 60 * 60_000).toISOString();
  let scheduled, cancelled;
  try { scheduled = await s.call('schedule_send', { draft_id: d.draft_id, version: d.version, send_at: sendAt }); }
  finally { cancelled = await s.call('cancel_scheduled_send', { draft_id: d.draft_id }).then(() => true, () => false); }
  return { draft_id: d.draft_id, status: scheduled?.status, schedule_status: scheduled?.schedule_status, send_at: scheduled?.send_at, direct_send: scheduled?.direct_send === true, approval_reason: scheduled?.approval_reason || null, approval_url_returned: !!scheduled?.approval_url, cancelled };
}

const argOf = (name, argv = process.argv) => { const i = argv.indexOf(name); return i > 0 ? argv[i + 1] : undefined; };

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
  const argv = process.argv;
  if (argv.includes('--help')) {
    console.log(`Usage:
  Permission levels: set LOCKBOX_MCP_URL, LOCKBOX_READ_KEY, LOCKBOX_DRAFT_KEY, LOCKBOX_SEND_KEY, then run with no options.
  One key:           set LOCKBOX_KEY, then
    node scripts/check-mcp-tools.mjs --url <mcp url> --access
    node scripts/check-mcp-tools.mjs --url <mcp url> --access --schedule-test --to you@example.com [--mailbox microsoft:you@example.com]
Keys are read from environment variables only and are never printed.`);
    return;
  }
  if (argv.includes('--access') || argv.includes('--schedule-test')) {
    try {
      const url = argOf('--url') || process.env.LOCKBOX_MCP_URL; const key = process.env.LOCKBOX_KEY;
      if (!url) throw new Error('Pass --url or set LOCKBOX_MCP_URL.');
      if (!key) throw new Error('Set LOCKBOX_KEY (it is never printed).');
      const { server, access } = await checkAccess(url, key);
      console.log(`Build: ${access.build || server}`);
      console.log(`Key: ${access.key ? `${access.key.name} (…${access.key.last4})` : 'unknown'}; connected via ${access.connected_via}`);
      for (const b of access.mailboxes) console.log(`  ${b.mailbox}: see=${b.see} draft=${b.draft} send=${b.send} direct_send=${b.direct_send}${b.connected ? '' : ' (not connected)'}`);
      if (argv.includes('--schedule-test')) {
        const to = argOf('--to'); if (!to) throw new Error('Pass --to with your own address.');
        const mailbox = argOf('--mailbox') || access.mailboxes.find(b => b.email && b.email.toLowerCase() === to.toLowerCase())?.mailbox;
        if (!mailbox) throw new Error('Pass --mailbox (for example microsoft:you@outlook.com).');
        const r = await scheduleTest(url, key, { mailbox, to });
        console.log(`Schedule test: status=${r.status} schedule_status=${r.schedule_status} send_at=${r.send_at} direct_send=${r.direct_send} approval_url=${r.approval_url_returned ? 'yes' : 'no'}${r.approval_reason ? ` reason=${r.approval_reason}` : ''} cancelled=${r.cancelled}`);
        if (r.status !== 'queued') process.exitCode = 1;
      }
    } catch (error) { console.error(`MCP check failed: ${error.message}`); process.exitCode = 1; }
    return;
  }
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
