// First-run admin Setup for a self-hosted Lockbox server: public URL, Gmail web client, optional Outlook web app.
import { useEffect, useState } from 'react';

const Icon = ({ name }) => <i aria-hidden="true" className={`bi bi-${name}`} />;
function Copy({ value }) {
  const [done, setDone] = useState(false);
  return <div className="setup-copy"><code>{value}</code><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { navigator.clipboard?.writeText(value); setDone(true); }}><Icon name={done ? 'check2' : 'clipboard'} /> {done ? 'Copied' : 'Copy'}</button></div>;
}

export default function SetupWizard({ bridge, onDone }) {
  const [view, setView] = useState(null);
  const [form, setForm] = useState({ publicUrl: '', gId: '', gSecret: '', mId: '', mSecret: '' });
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const load = () => bridge.getSetup().then(v => { setView(v); setForm(f => ({ ...f, publicUrl: v.publicUrl || (location.protocol === 'https:' ? location.origin : ''), gId: v.google.clientId, mId: v.microsoft.clientId })); }).catch(e => setError(e.message));
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
    {step === 2 && <form onSubmit={async e => { e.preventDefault(); if (await save({ microsoft: { clientId: form.mId, clientSecret: form.mSecret } })) onDone(); }}>
      {view.deviceAvailable ? <p className="small"><Icon name="check-circle" /> Outlook works already: people sign in with a one-time code. Nothing to set up.</p>
        : <p className="small text-danger">This server image has no Outlook sign-in-by-code client. Set up an Outlook web app below.</p>}
      <details open={!view.deviceAvailable || !!view.microsoft.clientId}>
        <summary className="small">My organization blocks sign-in by code (optional)</summary>
        <ol className="small setup-howto mt-2">
          <li>In <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">Microsoft Entra → App registrations</a>, create an app for any organization and personal accounts.</li>
          <li>Add a <strong>Web</strong> redirect URI with this exact address, and a client secret:</li>
        </ol>
        {view.callbacks && <Copy value={view.callbacks.microsoft} />}
        <label className="form-label mt-2">Application (client) ID</label>
        <input className="form-control" value={form.mId} onChange={set('mId')} disabled={view.microsoft.fromEnv} />
        <label className="form-label mt-2">Client secret</label>
        <input className="form-control" type="password" autoComplete="off" placeholder={view.microsoft.hasSecret ? 'Saved. Leave blank to keep it.' : ''} value={form.mSecret} onChange={set('mSecret')} disabled={view.microsoft.fromEnv} />
        {view.microsoft.clientId && !view.microsoft.fromEnv && <button type="button" className="btn btn-link btn-sm px-0" onClick={async () => { await save({ microsoft: { clear: true } }); setForm(f => ({ ...f, mId: '' })); }}>Remove and go back to sign-in by code</button>}
      </details>
      <div className="dialog-actions"><button type="button" className="btn btn-outline-secondary" onClick={() => setStep(1)}>Back</button><button className="btn btn-primary">Finish setup</button></div>
    </form>}
  </div>;
}
