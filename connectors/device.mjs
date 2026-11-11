// Microsoft device-code sign-in (RFC 8628). Lets a Docker server connect Outlook without its own Entra app.
import { getProvider } from './providers.mjs';

const DEVICE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode';

/** Turns Microsoft error codes into messages a person can act on. */
export function deviceError(json = {}) {
  const d = json.error_description || '';
  if (/AADSTS65001|AADSTS90094|consent/i.test(d) || json.error === 'consent_required') return 'admin_approval_required: Your organization needs an administrator to approve Lockbox before you can connect. Ask your IT admin, or have the Lockbox admin set up an Outlook web app in Setup.';
  if (/AADSTS50199|AADSTS530|AADSTS53003|blocked|conditional access/i.test(d)) return 'device_code_blocked: Your organization blocks sign-in by code. Ask the Lockbox admin to set up an Outlook web app in Setup.';
  if (json.error === 'access_denied' || json.error === 'authorization_declined') return 'declined: Sign-in was cancelled.';
  if (json.error === 'expired_token' || json.error === 'code_expired') return 'expired: The code expired. Start again.';
  return `failed: ${json.error || 'unknown_error'}`;
}

export async function startDeviceCode(clientId) {
  const res = await fetch(DEVICE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scope: getProvider('microsoft').scopes.join(' ') }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(deviceError(json));
  return { deviceCode: json.device_code, userCode: json.user_code, verificationUri: json.verification_uri, expiresAt: Date.now() + json.expires_in * 1000, interval: json.interval || 5 };
}

/** One poll. Returns { status: 'pending' | 'slow_down' } or { status: 'done', tokens }. Throws on final failure. */
export async function pollDeviceCode(clientId, deviceCode) {
  const res = await fetch(getProvider('microsoft').tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: deviceCode }) });
  const json = await res.json().catch(() => ({}));
  if (res.ok) return { status: 'done', tokens: { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 } };
  if (json.error === 'authorization_pending') return { status: 'pending' };
  if (json.error === 'slow_down') return { status: 'slow_down' };
  throw new Error(deviceError(json));
}
