// First-run admin Setup for a self-hosted Lockbox server: public URL and all mailbox-provider credentials.
import { useEffect, useState } from 'react';

const Icon = ({ name }) => <i aria-hidden="true" className={`bi bi-${name}`} />;
function Copy({ value }) {
  const [done, setDone] = useState(false);
  return <div className="setup-copy"><code>{value}</code><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { navigator.clipboard?.writeText(value); setDone(true); }}><Icon name={done ? 'check2' : 'clipboard'} /> {done ? 'Copied' : 'Copy'}</button></div>;
}

export default function SetupWizard({ bridge, onDone }) {
  const [view, setView] = useState(null);
  const [form, setForm] = useState({ publicUrl: '', gId: '', gSecret: '', dId: '', mId: '', mSecret: '' });
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const load = () => bridge.getSetup().then(v => { setView(v); setForm(f => ({ ...f, publicUrl: v.publicUrl || (location.protocol === 'https:' ? location.origin : ''), gId: v.google.clientId, dId: v.microsoftDevice?.clientId || '', mId: v.microsoft.clientId })); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const save = async body => { setError(''); try { setView(await bridge.saveSetup(body)); setForm(f => ({ ...f, gSecret: '', mSecret: '' })); return true; } catch (e) { setError(e.message === 'public_url_must_be_https' ? 'The address must start with https://' : e.message); return false; } };
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  if (!view) return <div className="setup-wizard">{error ? <p className="text-danger">{error}</p> : <p>Loading setup…</p>}<div className="dialog-actions"><button className="btn btn-outline-secondary" onClick={onDone}>Back</button></div></div>;
  const steps = ['Address', 'Gmail', 'Outlook'];
  return <div className="setup-wizard">
    <ol className="setup-steps">{steps.map((s, i) => <li key={s} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}><button type="button" onClick={() => setStep(i)}>{i + 1}. {s}</button></li>)}</ol>
    {error && <p className="text-danger small">{error}</p>}
    {step === 0 && <form onSubmit={async e => { e.preventDefault(); if (await save({ publicUrl: form.publicUrl })) setStep(1); }}>
      <label className="form-label">Public address of this Lockbox server</label>
      <input className="form-control" placeholder="https://mail.example.com" value={form.publicUrl} onChange={set('publicUrl')} disabled={view.publicUrlFromEnv} required />
      {view.publicUrlFromEnv && <small className="text-muted">Set by the server's settings file.</small>}
      <div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={onDone}>Cancel</button><button className="btn btn-primary">Save and continue</button></div>
    </form>}
    {step === 1 && <form onSubmit={async e => { e.preventDefault(); if (await save({ google: { clientId: form.gId, clientSecret: form.gSecret } })) setStep(2); }}>
      <p className="small">One-time setup so people on this server can click <strong>Connect Gmail</strong>.</p>
      <ol className="small setup-howto">
        <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud → Credentials</a> and turn on the Gmail API.</li>
        <li>Create an <strong>OAuth client ID</strong> of type <strong>Web application</strong>.</li>
        <li>Under <strong>Authorized redirect URIs</strong>, add this exact address:</li>
      </ol>
      {view.callbacks ? <Copy value={view.callbacks.google} /> : <p className="text-danger small">Save the public address first.</p>}
      <label className="form-label mt-2">Client ID</label>
      <input className="form-control" value={form.gId} onChange={set('gId')} disabled={view.google.fromEnv} required />
      <label className="form-label mt-2">Client secret</label>
      <input className="form-control" type="password" autoComplete="off" placeholder={view.google.hasSecret ? 'Saved. Leave blank to keep it.' : ''} value={form.gSecret} onChange={set('gSecret')} disabled={view.google.fromEnv} required={!view.google.hasSecret} />
      {view.google.fromEnv && <small className="text-muted">Set by the server's settings file.</small>}
      <div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={() => setStep(0)}>Back</button>{view.google.fromEnv ? <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Continue</button> : <button className="btn btn-primary">Save and continue</button>}</div>
    </form>}
    {step === 2 && <div>
      <form onSubmit={async e => { e.preventDefault(); await save({ microsoftDevice: { clientId: form.dId } }); }}>
        <p className="small">One-time setup so people on this server can click <strong>Connect Outlook</strong> and approve a one-time code.</p>
        <ol className="small setup-howto">
          <li>In <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">Microsoft Entra → App registrations</a>, create an app for any organization and personal accounts.</li>
          <li>Add the delegated Microsoft Graph permissions listed in the setup guide and enable <strong>Allow public client flows</strong>.</li>
          <li>Copy its <strong>Application (client) ID</strong> below. No client secret is needed for sign-in by code.</li>
        </ol>
        <label className="form-label mt-2">Outlook application (client) ID</label>
        <input className="form-control" value={form.dId} onChange={set('dId')} disabled={view.microsoftDevice.fromEnv} required />
        {view.microsoftDevice.fromEnv && <small className="text-muted">Set by the server's settings file.</small>}
        {view.deviceAvailable && <p className="small mt-2 mb-0"><Icon name="check-circle" /> Outlook sign-in by code is configured.</p>}
        {!view.microsoftDevice.fromEnv && <div className="dialog-actions"><button className="btn btn-primary">Save Outlook sign-in</button></div>}
      </form>
      <details className="mt-3" open={!!view.microsoft.clientId}>
        <summary className="small">Use an Outlook web app instead (optional)</summary>
        <form onSubmit={async e => { e.preventDefault(); if (await save({ microsoft: { clientId: form.mId, clientSecret: form.mSecret } })) onDone(); }}>
          <p className="small text-muted mt-2">Use this only if an organization blocks sign-in by code. A configured web app takes precedence.</p>
          <ol className="small setup-howto">
            <li>Create a separate Microsoft Entra registration with a <strong>Web</strong> redirect URI and a client secret.</li>
            <li>Add this exact redirect URI:</li>
          </ol>
          {view.callbacks && <Copy value={view.callbacks.microsoft} />}
          <label className="form-label mt-2">Application (client) ID</label>
          <input className="form-control" value={form.mId} onChange={set('mId')} disabled={view.microsoft.fromEnv} required />
          <label className="form-label mt-2">Client secret</label>
          <input className="form-control" type="password" autoComplete="off" placeholder={view.microsoft.hasSecret ? 'Saved. Leave blank to keep it.' : ''} value={form.mSecret} onChange={set('mSecret')} disabled={view.microsoft.fromEnv} required={!view.microsoft.hasSecret} />
          {view.microsoft.clientId && !view.microsoft.fromEnv && <button type="button" className="btn btn-link btn-sm px-0" onClick={async () => { await save({ microsoft: { clear: true } }); setForm(f => ({ ...f, mId: '' })); }}>Remove web app and use sign-in by code</button>}
          <div className="dialog-actions"><button className="btn btn-primary">Save Outlook web app</button></div>
        </form>
      </details>
      <div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={() => setStep(1)}>Back</button><button type="button" className="btn btn-primary" onClick={onDone}>Finish setup</button></div>
    </div>}
  </div>;
}
