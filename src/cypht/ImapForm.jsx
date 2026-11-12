import { useState } from 'react';
import { IMAP_PRESETS, presetForEmail, imapErrorText } from './mailbox-demo.js';

const Icon = ({ name }) => <i aria-hidden="true" className={`bi bi-${name}`} />;
const blank = { email: '', name: '', username: '', password: '', preset: 'custom', imap: { ...IMAP_PRESETS.custom.imap }, smtp: { ...IMAP_PRESETS.custom.smtp } };

/** IMAP/SMTP connection form shared by Add mailbox and the Servers page. */
export default function ImapForm({ box, live, onTest, onSave, onBack }) {
  const [f, setF] = useState(() => box ? { ...blank, email: box.email, name: box.settings?.name || '', username: box.settings?.username || '', imap: { ...box.settings.imap }, smtp: { ...box.settings.smtp }, preset: presetForEmail(box.email) } : blank);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const preset = IMAP_PRESETS[f.preset];
  const applyPreset = key => setF(x => ({ ...x, preset: key, imap: { ...IMAP_PRESETS[key].imap }, smtp: { ...IMAP_PRESETS[key].smtp } }));
  const setSide = (side, k, v) => setF(x => ({ ...x, [side]: { ...x[side], [k]: k === 'port' ? v.replace(/\D/g, '') : v } }));
  const payload = () => ({ email: f.email.trim(), name: f.name.trim(), username: f.username.trim() || f.email.trim(), password: f.password, imap: { ...f.imap, port: Number(f.imap.port) }, smtp: { ...f.smtp, port: Number(f.smtp.port) } });
  const run = async kind => {
    setBusy(kind); setMsg(null);
    try { if (kind === 'test') { await onTest(payload()); setMsg({ ok: true, text: 'Both servers answered and accepted your sign-in.' }); } else await onSave(payload()); }
    catch (e) { setMsg({ ok: false, text: imapErrorText(e.message) }); }
    finally { setBusy(null); }
  };
  const side = (key, label) => <fieldset className="imap-side"><legend>{label}</legend>
    <label>Server<input className="form-control" required value={f[key].host} placeholder={key === 'imap' ? 'imap.example.com' : 'smtp.example.com'} onChange={e => setSide(key, 'host', e.target.value)} /></label>
    <div className="imap-row"><label>Port<input className="form-control" inputMode="numeric" required value={f[key].port} onChange={e => setSide(key, 'port', e.target.value)} /></label>
      <label>Security<select className="form-select" value={f[key].security} onChange={e => setSide(key, 'security', e.target.value)}><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option></select></label></div>
  </fieldset>;
  return <form className="imap-form" onSubmit={e => { e.preventDefault(); run('save'); }}>
    {!live && <p className="imap-note"><Icon name="info-circle" /> Demo: no real server is contacted here. Your password is not saved.</p>}
    <div className="imap-row">
      <label>Email address<input className="form-control" type="email" required disabled={!!box} value={f.email} onChange={e => { const email = e.target.value; setF(x => ({ ...x, email })); if (!box) { const p = presetForEmail(email); if (p !== 'custom' && p !== f.preset) applyPreset(p); } }} /></label>
      <label>Provider<select className="form-select" value={f.preset} onChange={e => applyPreset(e.target.value)}>{Object.entries(IMAP_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</select></label>
    </div>
    <div className="imap-row">
      <label>Password or app password<input className="form-control" type="password" autoComplete="new-password" required={!box?.settings?.hasPassword} placeholder={box?.settings?.hasPassword ? 'Saved — leave blank to keep' : ''} value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} /></label>
      <label>Display name <small>(optional)</small><input className="form-control" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></label>
    </div>
    {preset.appPassword && <p className="imap-hint"><Icon name="key" /> {preset.name} usually needs an app password, created in your account's security settings.</p>}
    {preset.desktopOnly && <p className="imap-hint"><Icon name="pc-display" /> Proton Mail Bridge runs on your own computer, so this works in the desktop app only.</p>}
    <details className="imap-advanced" open={f.preset === 'custom' || !!box}><summary>Server settings</summary>
      <label>Username <small>(if different from email)</small><input className="form-control" value={f.username} placeholder={f.email} onChange={e => setF(x => ({ ...x, username: e.target.value }))} /></label>
      <div className="imap-sides">{side('imap', 'Incoming (IMAP)')}{side('smtp', 'Outgoing (SMTP)')}</div>
    </details>
    {msg && <p className={`imap-msg ${msg.ok ? 'is-ok' : 'is-bad'}`} role="status"><Icon name={msg.ok ? 'check-circle' : 'exclamation-triangle'} /> {msg.text}</p>}
    <div className="dialog-actions"><button type="button" className="btn btn-outline-secondary me-auto" onClick={onBack}>Back</button>
      <button type="button" className="btn btn-outline-secondary" disabled={!!busy} onClick={e => { if (e.currentTarget.form.reportValidity()) run('test'); }}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
      <button className="btn btn-primary" type="submit" disabled={!!busy}>{busy === 'save' ? 'Connecting…' : box ? 'Save changes' : 'Connect'}</button></div>
  </form>;
}
