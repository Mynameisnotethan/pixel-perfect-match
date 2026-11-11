// Sign-in and first-run setup for a self-hosted Lockbox server.
//
// The preview (no server) and the desktop app never show these screens: they keep their own
// clearly-labelled demo / OS-vault sign-in. Only the Docker build (VITE_LOCKBOX_MAIL_API=1) gates
// the app behind a real session.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import logoDark from '../assets/lockbox-logo-dark.png.asset.json';
import logoLight from '../assets/lockbox-logo-light.png.asset.json';
import { liveBridge } from './mailbox-live.js';

const Icon = ({ name }) => <i aria-hidden="true" className={`bi bi-${name}`} />;

const MESSAGES = {
  setup_code_incorrect: 'That setup code is not right. Copy it again from the mail container logs.',
  already_configured: 'This server is already set up. Sign in instead.',
  username_invalid: 'Use 2-32 letters, numbers, dots, dashes or underscores, starting with a letter or number.',
  password_too_short: 'Use at least 10 characters.',
  invalid_credentials: 'That username and password do not match.',
  too_many_attempts: 'Too many attempts. Wait a few minutes and try again.',
  csrf_check_failed: 'Your session expired. Sign in again.',
  sign_in_required: 'Please sign in again.',
};
/** Turns a server error code into a sentence a non-developer can act on. */
export const authMessage = (e, fallback = 'Something went wrong. Please try again.') =>
  MESSAGES[String(e?.message || '').trim()] || fallback;

const AuthContext = createContext({ status: 'demo', user: null, web: false, notice: '' });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const bridge = liveBridge();
  const web = bridge?.runtime === 'web';
  const [state, setState] = useState(() => (web
    ? { status: 'loading', user: null }
    : bridge ? { status: 'ok', user: 'desktop' } : { status: 'demo', user: 'demo' }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!web) return undefined;
    let alive = true;
    bridge.session()
      .then(s => { if (alive) setState({ ...s, notice: '' }); })
      // An unreachable server must not look like a wrong password: offer to try again.
      .catch(() => { if (alive) setState({ status: 'offline', user: null }); });
    return () => { alive = false; };
  }, [web, nonce]);
  const value = useMemo(() => ({
    ...state,
    web,
    refresh: () => setNonce(n => n + 1),
    signIn: async (username, password) => { const s = await bridge.login(username, password); setState({ status: 'ok', user: s.user, notice: '' }); },
    createAdmin: async body => { await bridge.setup(body); setState({ status: 'needs-login', user: null, notice: 'Lockbox is set up. Sign in with the account you just created.' }); },
    signOut: async () => { await bridge.logout(); setState({ status: 'needs-login', user: null, notice: '' }); },
  }), [state, web, nonce]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Shell({ children }) {
  return <div className="auth-screen">
    <div className="auth-card">
      <img className="auth-logo" src={logoDark.url} alt="Lockbox" />
      {children}
    </div>
  </div>;
}
function Splash() {
  return <Shell><p className="auth-loading"><Icon name="hourglass-split" /> Opening Lockbox…</p></Shell>;
}
function Field({ label, hint, children }) {
  return <label className="auth-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function SetupScreen() {
  const auth = useAuth();
  const [form, setForm] = useState({ code: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await auth.createAdmin({ code: form.code.trim(), username: form.username.trim(), password: form.password }); }
    catch (err) { setError(authMessage(err)); }
    finally { setBusy(false); }
  };
  return <Shell>
    <h1>Set up Lockbox</h1>
    <p className="auth-lead">This server has no accounts yet. Enter the one-time setup code, then choose the administrator login you will use from now on.</p>
    <details className="auth-where">
      <summary><Icon name="question-circle" /> Where do I find the setup code?</summary>
      <ol>
        <li>In Hostinger, open <strong>Docker Manager</strong> and choose this project.</li>
        <li>Open the <strong>mail</strong> container's <strong>logs</strong>.</li>
        <li>Copy the line that reads <code>one-time setup code</code> and the code under it.</li>
      </ol>
      <p>The code appears only in those logs. It stops working for good as soon as an account exists.</p>
    </details>
    {error && <p className="auth-error" role="alert"><Icon name="exclamation-triangle-fill" /> {error}</p>}
    <form onSubmit={submit} className="auth-form">
      <Field label="Setup code"><input className="form-control auth-code" value={form.code} onChange={set('code')} placeholder="XXXXX-XXXXX-XXXXX" autoComplete="off" spellCheck={false} required /></Field>
      <Field label="Administrator username" hint="Letters, numbers, dots, dashes or underscores.">
        <input className="form-control" value={form.username} onChange={set('username')} autoComplete="username" required />
      </Field>
      <Field label="Password" hint="At least 10 characters.">
        <input className="form-control" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required />
      </Field>
      <button className="btn btn-primary auth-submit" disabled={busy}>{busy ? 'Creating…' : 'Create administrator'}</button>
    </form>
    <p className="auth-foot"><Icon name="info-circle" /><span>Next: sign in, then open <strong className="auth-nowrap">Add mailbox → Setup</strong> to add your own Google and Outlook app credentials.</span></p>
  </Shell>;
}

function LoginScreen() {
  const auth = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await auth.signIn(form.username.trim(), form.password); }
    catch (err) { setError(authMessage(err)); }
    finally { setBusy(false); }
  };
  return <Shell>
    <h1>Sign in to Lockbox</h1>
    {auth.notice && <p className="auth-notice"><Icon name="check-circle-fill" /> {auth.notice}</p>}
    {error && <p className="auth-error" role="alert"><Icon name="exclamation-triangle-fill" /> {error}</p>}
    <form onSubmit={submit} className="auth-form">
      <Field label="Username"><input className="form-control" value={form.username} onChange={set('username')} autoComplete="username" autoFocus required /></Field>
      <Field label="Password"><input className="form-control" type="password" value={form.password} onChange={set('password')} autoComplete="current-password" required /></Field>
      <button className="btn btn-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p className="auth-foot"><Icon name="shield-lock" /><span>Your mail stays on this server. Google and Outlook only share what you approved when connecting a mailbox.</span></p>
  </Shell>;
}

function OfflineScreen() {
  const auth = useAuth();
  return <Shell>
    <h1>Lockbox could not reach its server</h1>
    <p className="auth-lead">The page loaded, but the mail service did not answer. It may still be starting up.</p>
    <button className="btn btn-primary auth-submit" onClick={auth.refresh}>Try again</button>
  </Shell>;
}

/** Blocks the app until a real session exists (web builds only). */
export function AuthGate({ children }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <Splash />;
  if (auth.status === 'needs-setup') return <SetupScreen />;
  if (auth.status === 'needs-login') return <LoginScreen />;
  if (auth.status === 'offline') return <OfflineScreen />;
  return children;
}
