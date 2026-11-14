// The owner's approval page for an AI draft. Served by the mail server at /api/ai/approve/:id so it works
// behind any proxy. It needs the signed-in Lockbox session; the form carries the session's CSRF token and
// the hash of the exact version shown, so only that version can be approved.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const shell = (title, inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Lockbox</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f6;color:#1d2b2b;margin:0;padding:32px 16px}main{background:#fff;max-width:640px;margin:0 auto;padding:28px;border-radius:12px;box-shadow:0 4px 20px #0001}h1{font-size:20px;margin:0 0 6px}p{color:#4c5b5b;font-size:14px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;margin:18px 0}dt{font-weight:600;color:#4c5b5b}dd{margin:0;word-break:break-word}pre{white-space:pre-wrap;word-break:break-word;background:#f4f6f6;border:1px solid #dfe6e6;border-radius:8px;padding:14px;font:14px/1.5 system-ui,sans-serif;max-height:50vh;overflow:auto}.row{display:flex;gap:10px;margin-top:18px}button,a.btn{flex:1;padding:10px;border:0;border-radius:8px;background:#0f766e;color:#fff;font:inherit;cursor:pointer;text-align:center;text-decoration:none}a.btn.secondary{background:#e4ebeb;color:#1d2b2b}.ok{color:#0f766e;font-weight:600}.err{color:#b42318}</style></head><body><main>${inner}</main></body></html>`;

export const approvePage = (d, csrf, note = '') => shell('Approve email', `<h1>Approve this email?</h1>
<p>An AI agent asked to send this from your mailbox. Check every line. Only this exact version will be sent, once. If the agent changes it, you'll be asked again.</p>
${note ? `<p class="err">${esc(note)}</p>` : ''}
<dl><dt>From</dt><dd>${esc(d.from)}</dd><dt>To</dt><dd>${esc(d.to) || '—'}</dd><dt>CC</dt><dd>${esc(d.cc) || '—'}</dd><dt>BCC</dt><dd>${esc(d.bcc) || '—'}</dd><dt>Subject</dt><dd>${esc(d.subject) || '(no subject)'}</dd><dt>Version</dt><dd>${esc(d.version)}</dd></dl>
<pre>${esc(d.body)}</pre>
<form method="post" class="row"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="hash" value="${esc(d.hash)}">
<a class="btn secondary" href="/">Not now</a><button type="submit">Approve sending</button></form>`);

export const approvedPage = d => shell('Approved', `<h1 class="ok">Approved</h1><p>${d.sent ? 'This email was already sent.' : 'Go back to your AI app and ask it to send the draft. It will be sent once.'}</p><dl><dt>To</dt><dd>${esc(d.to)}</dd><dt>Subject</dt><dd>${esc(d.subject)}</dd></dl><div class="row"><a class="btn secondary" href="/">Open Lockbox</a></div>`);

export const messagePage = (title, text) => shell(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p><div class="row"><a class="btn secondary" href="/">Open Lockbox</a></div>`);

// A link opened from another site arrives without Lockbox's same-site cookies; one same-site reload fixes that.
export const reloadPage = () => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=?s=1"><title>Lockbox</title></head><body><p><a href="?s=1">Continue</a></p></body></html>`;
