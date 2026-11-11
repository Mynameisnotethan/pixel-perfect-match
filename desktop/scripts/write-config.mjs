// Writes desktop/release-config.json from build-time environment variables.
// Official releases run this with Lockbox's public desktop client IDs; forks run it with their own.
// Only public-client values belong here: never put a confidential web-client secret in this file.
import fs from 'node:fs';
const cfg = {
  appUrl: process.env.LOCKBOX_URL,
  googleClientId: process.env.LOCKBOX_GOOGLE_DESKTOP_CLIENT_ID,
  // Google issues a "secret" to Desktop-type clients; it is not confidential and PKCE protects the flow.
  googleInstalledAppSecret: process.env.LOCKBOX_GOOGLE_DESKTOP_CLIENT_SECRET,
  microsoftClientId: process.env.LOCKBOX_MS_DESKTOP_CLIENT_ID,
};
const missing = Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k);
if (missing.length && process.env.LOCKBOX_ALLOW_PARTIAL !== '1') { console.error(`Missing release config: ${missing.join(', ')}`); process.exit(1); }
if (/secret/i.test(JSON.stringify(Object.keys(process.env).filter(k => k.startsWith('LOCKBOX_') && /(WEB|MS)_CLIENT_SECRET|TOKEN_KEY/.test(k))))) console.warn('Note: web-client secrets are ignored and never written to the desktop build.');
fs.writeFileSync(new URL('../release-config.json', import.meta.url), JSON.stringify(cfg, null, 2));
console.log('Wrote desktop/release-config.json');
// Bundle the shared provider code inside the desktop package so the installer is self-contained.
fs.cpSync(new URL('../../connectors', import.meta.url), new URL('../connectors', import.meta.url), { recursive: true });
