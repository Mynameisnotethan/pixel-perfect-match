// Lockbox desktop shell (Electron). OAuth runs in the native process:
// system browser + PKCE + loopback callback; tokens live in the OS credential vault (keytar).
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import keytar from 'keytar';
import { createPkce, buildAuthUrl, exchangeCode, stateMatches, ensureFresh, ReconnectRequired } from '../connectors/oauth.mjs';
import { mail, upsertMailbox } from '../connectors/mail.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = 'Lockbox Mailboxes';
// Desktop OAuth client registrations (Google "Desktop app", Entra "Mobile and desktop").
const clients = {
  google: { clientId: process.env.LOCKBOX_GOOGLE_DESKTOP_CLIENT_ID, clientSecret: process.env.LOCKBOX_GOOGLE_DESKTOP_CLIENT_SECRET },
  microsoft: { clientId: process.env.LOCKBOX_MS_DESKTOP_CLIENT_ID },
};

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
  try {
    const t = await ensureFresh(box.provider, await tokensFor(id), clients[box.provider], next => saveTokens(id, next));
    return await fn(t.accessToken, box);
  } catch (e) {
    if (e instanceof ReconnectRequired || e.status === 401) { await writeIndex(list.map(b => b.id === id ? { ...b, status: 'reconnect' } : b)); throw new Error('reconnect_required'); }
    throw e;
  }
}

ipcMain.handle('mailbox:list', () => readIndex());
ipcMain.handle('mailbox:connect', (_e, provider) => connect(provider));
ipcMain.handle('mailbox:sync', (_e, id) => withToken(id, (t, box) => mail[box.provider].inbox(t)));
ipcMain.handle('mailbox:send', (_e, id, msg) => withToken(id, (t, box) => mail[box.provider].send(t, box.email, msg)));
ipcMain.handle('mailbox:disconnect', async (_e, id) => { await keytar.deletePassword(SERVICE, `tokens:${id}`); await writeIndex((await readIndex()).filter(b => b.id !== id)); });

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 860, webPreferences: { preload: path.join(dir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  win.loadURL(process.env.LOCKBOX_URL || 'http://localhost:8080');
});
app.on('window-all-closed', () => app.quit());
