# Connect an Agent wizard (AI Access)

## What you'll get
A **Connect an Agent** button at the top of AI Access opens a step-by-step wizard (progress bar, Back/Next, copy buttons). Progress survives switching tabs; reopening the button restarts or resumes.

First screen: choose **ChatGPT**, **Claude**, or **Grok — API setup**.

1. **Choose access** – pick an existing key or create one named after the assistant. Pick mailboxes and toggle Read reviewed emails / Manage drafts / Send emails (Send requires drafts; explained as direct sending and scheduling without an approval page). Mailboxes needing reconnection are flagged; if none exist, a link opens Add mailbox and the wizard resumes afterward. Saves through the same permission logic as the key Edit screen.
2. **Copy connection details** – MCP URL built from the installation's configured public URL (`{publicUrl}/api/ai/v1/mcp`), never hardcoded. New keys: secret shown once with Copy API key and where to paste it. Existing keys: name + last four, with a note that you need your saved key or a new one.
3. **Configure the assistant** – provider-specific steps checked against official docs, with links:
   - ChatGPT: custom MCP app/connector (depends on plan/workspace), name Lockbox, URL, OAuth + automatic registration, Lockbox key on the authorization page, enabling it in chat; expandable Bearer-key alternative (env-var name vs token field).
   - Claude: custom connector, Lockbox + URL, OAuth "Register automatically", key on authorization page, workspace-owner step, enabling it.
   - Grok: clearly labeled xAI API integration; copyable remote-MCP sample with environment-variable placeholders for the xAI key and Lockbox key, example request calling `get_access`. No invented chat menu.
4. **Verify** – Copy test prompt (exact wording requested). Shows saved permissions and connection activity from the backend, refreshing when you return to the tab. Three separate statuses: server reachable, authenticated request seen, tool call seen — each marked verified only if the server observed it; otherwise a "I confirmed it works" checkbox.
5. **Try it** – copyable prompts: list recent reviewed emails, self-addressed test draft, send it, schedule one 5 minutes later (send/schedule only if the key can send). Notes where Drafts and Scheduled are. The wizard itself never sends.

Troubleshooting panel: missing tools (reconnect/refresh to reload tool list), wrong key, `direct_send: false`, mailbox reconnection, provider setting unavailable, unreachable URL. **Done** shows a summary (assistant, key, mailboxes, permissions, verification result). Keyboard and mobile friendly.

## Technical details
- New `src/cypht/AgentWizard.jsx` (+ `agent-wizard.js` for pure helpers: URL builder, prompts, provider configs, step validation), styles in `preview.css` matching `.ai-key*`.
- Reuse `AiKeys.jsx` create/update APIs and `connectors/ai-perms.mjs` rules; extract shared permission editor if needed.
- Public URL: read from existing server setup config (`server/setup.mjs`) via an existing/added non-secret endpoint; fallback `window.location.origin` labeled as such.
- Observability: extend key records with server-observed `lastAuthAt`, `lastToolCallAt`, `lastToolName` recorded in `ai-mcp.mjs` (no secrets); expose through existing key list. Reachability probes `/api/ai/v1/mcp` unauthenticated expecting `api_key_required`.
- Wizard state in `sessionStorage` without the secret; secret held in memory only, never in URLs, logs or copied prompts.
- Tests: URL builder, permission dependency (send needs drafts), prompts omit secrets, status only "verified" from backend timestamps, observed-activity recording. Playwright run through all three paths in the preview.
- Live ChatGPT/Claude/xAI connections remain unverified from here.
