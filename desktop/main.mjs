// Lockbox desktop shell (Electron). OAuth runs in the native process:
// system browser + PKCE + loopback callback; tokens live in the OS credential vault (keytar).
import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import keytar from 'keytar';
import { createPkce, buildAuthUrl, exchangeCode, stateMatches, ensureFresh, ReconnectRequired } from './connectors/oauth.mjs';
import { mail, upsertMailbox } from './connectors/mail.mjs';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { createImapClient, normalizeImap } from './connectors/imap.mjs';
// The desktop runs on the user's own computer, so home-network mail servers are allowed.
const imap = createImapClient({ ImapFlow, nodemailer, allowPrivate: true });

const dir = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = 'Lockbox Mailboxes';
// Desktop OAuth client registrations (Google "Desktop app", Entra "Mobile and desktop").
// Official releases bake these in at build time (release-config.json, written by scripts/write-config.mjs).
// Environment variables override them for local development.
import fs from 'node:fs';
const baked = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'release-config.json'), 'utf8')); } catch { return {}; } })();
const pick = (env, key) => process.env[env] || baked[key] || undefined;
const clients = {
  google: { clientId: pick('LOCKBOX_GOOGLE_DESKTOP_CLIENT_ID', 'googleClientId'), clientSecret: pick('LOCKBOX_GOOGLE_DESKTOP_CLIENT_SECRET', 'googleInstalledAppSecret') },
  microsoft: { clientId: pick('LOCKBOX_MS_DESKTOP_CLIENT_ID', 'microsoftClientId') },
};
// The screens are bundled into the installer (renderer-dist) and served from app://lockbox.
// LOCKBOX_DEV_URL only exists for local development against a running dev server.
const APP_URL = process.env.LOCKBOX_DEV_URL || 'app://lockbox/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const appOrigin = new URL(APP_URL).origin;

// The mailbox index (no tokens) is stored in the vault too, under a fixed key.
const readIndex = async () => JSON.parse((await keytar.getPassword(SERVICE, 'index')) || '[]');
const writeIndex = list => keytar.setPassword(SERVICE, 'index', JSON.stringify(list));
const tokensFor = async id => JSON.parse((await keytar.getPassword(SERVICE, `tokens:${id}`)) || 'null');
const saveTokens = (id, t) => keytar.setPassword(SERVICE, `tokens:${id}`, JSON.stringify(t));

/** Starts a one-shot loopback listener on a random port and resolves with the validated code. */
function startLoopback(expectedState) {
  return new Promise((ready, fail) => {
    let finish;
    const code = new Promise((resolve, reject) => { finish = { resolve, reject }; });
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const value = url.searchParams.get('code');
      const ok = stateMatches(expectedState, url.searchParams.get('state')) && value;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html' }).end(ok ? '<p>Lockbox is connected. You can close this tab.</p>' : '<p>Sign-in could not be verified. Return to Lockbox and try again.</p>');
      server.close(); clearTimeout(timer);
      ok ? finish.resolve(value) : finish.reject(new Error(url.searchParams.get('error') || 'state_mismatch'));
    });
    const timer = setTimeout(() => { server.close(); finish.reject(new Error('timeout')); }, 5 * 60_000);
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => ready({ redirectUri: `http://127.0.0.1:${server.address().port}/callback`, code }));
  });
}

async function connect(providerId) {
  const client = clients[providerId];
  if (!client?.clientId) throw new Error(`No desktop OAuth client configured for ${providerId}`);
  const { verifier, challenge, state } = await createPkce();
  const { redirectUri, code: codePromise } = await startLoopback(state);
  await shell.openExternal(buildAuthUrl(providerId, { clientId: client.clientId, redirectUri, challenge, state }));
  const code = await codePromise;
  const tokens = await exchangeCode(providerId, { code, verifier, redirectUri, ...client });
  const { email } = await mail[providerId].profile(tokens.accessToken);
  const list = upsertMailbox(await readIndex(), { id: `${providerId}:${email.toLowerCase()}`, provider: providerId, email, status: 'connected' });
  const box = list.find(b => b.provider === providerId && b.email.toLowerCase() === email.toLowerCase());
  await saveTokens(box.id, tokens); await writeIndex(list);
  return box;
}

async function withToken(id, fn) {
  const list = await readIndex(); const box = list.find(b => b.id === id);
  if (!box) throw new Error('Mailbox not found');
  if (box.provider === 'imap') return fn(null, box, await tokensFor(id));
  try {
    const t = await ensureFresh(box.provider, await tokensFor(id), clients[box.provider], next => saveTokens(id, next));
    return await fn(t.accessToken, box);
  } catch (e) {
    if (e instanceof ReconnectRequired || e.status === 401) { await writeIndex(list.map(b => b.id === id ? { ...b, status: 'reconnect' } : b)); throw new Error('reconnect_required'); }
    throw e;
  }
}

const guard = e => { if (new URL(e.senderFrame.url).origin !== appOrigin) throw new Error('forbidden'); };
const on = (channel, fn) => ipcMain.handle(channel, (e, ...args) => { guard(e); return fn(...args); });
on('mailbox:list', () => readIndex());
on('mailbox:connect', provider => connect(provider));
on('mailbox:sync', id => withToken(id, (t, box, s) => box.provider === 'imap' ? imap.inbox(s) : mail[box.provider].inbox(t)));
on('mailbox:send', (id, msg) => withToken(id, (t, box, s) => box.provider === 'imap' ? imap.send(s, msg) : mail[box.provider].send(t, box.email, msg)));
async function imapSettings(body) {
  const id = `imap:${String(body.email || '').trim().toLowerCase()}`;
  const prev = await tokensFor(id);
  return { id, s: normalizeImap({ ...body, password: body.password || prev?.password || '' }, { allowPrivate: true }) };
}
on('mailbox:imapTest', async body => { const { s } = await imapSettings(body); await imap.test(s); return { ok: true }; });
on('mailbox:imapSave', async body => {
  const { id, s } = await imapSettings(body); await imap.test(s);
  const list = upsertMailbox(await readIndex(), { id, provider: 'imap', email: s.email, status: 'connected', settings: { username: s.username, name: s.name, imap: s.imap, smtp: s.smtp, hasPassword: true } });
  await saveTokens(id, s); await writeIndex(list);
  return list.find(b => b.id === id);
});
on('mailbox:disconnect', async id => { await keytar.deletePassword(SERVICE, `tokens:${id}`); await writeIndex((await readIndex()).filter(b => b.id !== id)); });

app.whenReady().then(() => {
  const root = path.join(dir, 'renderer-dist');
  protocol.handle('app', req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(fs.existsSync(file) ? file : path.join(root, 'index.html')).toString());
  });
  const win = new BrowserWindow({ width: 1280, height: 860, webPreferences: { preload: path.join(dir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  // The mailbox bridge is only for the Lockbox UI: keep the window on its origin, open other links in the browser.
  win.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== appOrigin) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(APP_URL);
});
app.on('window-all-closed', () => app.quit());
