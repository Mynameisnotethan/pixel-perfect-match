// Shared Gmail + Microsoft Graph provider config. Used by the desktop shell and the Docker server.
export const PROVIDERS = {
  google: {
    id: 'google', name: 'Gmail',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    // Identify the mailbox, read mail, send mail. Nothing else.
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  microsoft: {
    id: 'microsoft', name: 'Outlook',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'offline_access', 'User.Read', 'Mail.Read', 'Mail.Send'],
    extraAuthParams: { prompt: 'select_account' },
  },
};
export const getProvider = id => { const p = PROVIDERS[id]; if (!p) throw new Error(`Unknown provider: ${id}`); return p; };
