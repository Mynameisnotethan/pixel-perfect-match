// Authorization Code + PKCE helpers, runtime-agnostic (Node 18+ / Electron: global fetch + WebCrypto).
import { getProvider } from './providers.mjs';

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function createPkce() {
  const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge, state: random(24) };
}

export function buildAuthUrl(providerId, { clientId, redirectUri, challenge, state }) {
  const p = getProvider(providerId);
  const url = new URL(p.authUrl);
  Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: p.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', ...p.extraAuthParams })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

/** Constant-time state check. */
export function stateMatches(expected, received) {
  if (!expected || !received || expected.length !== received.length) return false;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

export class ReconnectRequired extends Error { constructor(msg) { super(msg); this.name = 'ReconnectRequired'; } }

async function tokenRequest(providerId, params, clientSecret) {
  const p = getProvider(providerId);
  const body = new URLSearchParams(params);
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetch(p.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Never log tokens; only the provider error code.
    if (json.error === 'invalid_grant' || json.error === 'interaction_required') throw new ReconnectRequired(json.error);
    throw new Error(`Token request failed [${res.status}]: ${json.error || 'unknown_error'}`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token || params.refresh_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
}

export const exchangeCode = (providerId, { code, verifier, clientId, clientSecret, redirectUri }) =>
  tokenRequest(providerId, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri }, clientSecret);

export const refreshTokens = (providerId, { refreshToken, clientId, clientSecret }) => {
  if (!refreshToken) throw new ReconnectRequired('missing_refresh_token');
  return tokenRequest(providerId, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, scope: getProvider(providerId).scopes.join(' ') }, clientSecret);
};

/** Returns a valid access token, refreshing (and persisting via save) when within 60s of expiry. */
export async function ensureFresh(providerId, tokens, client, save) {
  if (tokens.accessToken && tokens.expiresAt - 60_000 > Date.now()) return tokens;
  const next = await refreshTokens(providerId, { refreshToken: tokens.refreshToken, ...client });
  await save(next);
  return next;
}
