// First-run Setup wizard data. Secrets are write-only: the wizard can set them but never reads them back.
const clean = v => (typeof v === 'string' ? v.trim() : undefined);
export function applySetup(config, body = {}) {
  const next = { ...config };
  if (body.publicUrl !== undefined) {
    const u = clean(body.publicUrl).replace(/\/$/, '');
    if (u && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(u)) throw Object.assign(new Error('public_url_must_be_https'), { status: 400 });
    next.publicUrl = u;
  }
  if (body.microsoftDevice) {
    const b = body.microsoftDevice;
    const prev = next.microsoftDevice || {};
    next.microsoftDevice = { clientId: b.clientId !== undefined ? clean(b.clientId) : prev.clientId };
    if (b.clear) next.microsoftDevice = {};
  }
  for (const p of ['google', 'microsoft']) {
    const b = body[p]; if (!b) continue;
    const prev = next[p] || {};
    next[p] = { clientId: b.clientId !== undefined ? clean(b.clientId) : prev.clientId, clientSecret: b.clientSecret ? clean(b.clientSecret) : prev.clientSecret };
    if (b.clear) next[p] = {};
  }
  return next;
}
export function setupView({ config, env, publicUrl, microsoftMode, deviceAvailable }) {
  const side = p => ({ clientId: config[p]?.clientId || '', hasSecret: !!config[p]?.clientSecret, fromEnv: !!env[p === 'google' ? 'LOCKBOX_GOOGLE_CLIENT_ID' : 'LOCKBOX_MS_CLIENT_ID'] });
  return {
    publicUrl, publicUrlFromEnv: !!env.LOCKBOX_PUBLIC_URL,
    callbacks: publicUrl ? { google: `${publicUrl}/oauth/google/callback`, microsoft: `${publicUrl}/oauth/microsoft/callback` } : null,
    google: side('google'), microsoft: side('microsoft'),
    microsoftDevice: { clientId: env.LOCKBOX_MS_DEVICE_CLIENT_ID || config.microsoftDevice?.clientId || '', fromEnv: !!env.LOCKBOX_MS_DEVICE_CLIENT_ID },
    microsoftMode, deviceAvailable,
  };
}
