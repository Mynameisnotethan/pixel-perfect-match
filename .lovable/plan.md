# Native MCP endpoint in Lockbox

Goal: one address, `https://<your-domain>/api/ai/v1/mcp`, that ChatGPT, Claude Desktop, Cursor and other AI tools can connect to. It returns the same privacy-protected email the current AI API returns: reviewed mail only, hidden parts already replaced on the server.

## What you will get
- **MCP endpoint** inside the existing mail server. No new container, port or Hostinger setting. One redeploy.
- **Two read-only tools:**
  - `list_messages`: recent reviewed emails (subject, sender, date, snippet, attachment names), redacted. Optional mailbox filter and limit.
  - `get_message`: one email by id, redacted the same way. Hidden labels show, e.g. `[hidden: Financial info]`.
- **Key options:**
  - Claude Desktop, Cursor and other tools: paste the URL and add the `Authorization: Bearer lbx_...` header.
  - ChatGPT: its plugins/apps only accept OAuth sign-in or no sign-in. Lockbox gets a small built-in sign-in page. ChatGPT opens it, you paste an `lbx_...` key once, and ChatGPT gets an access token tied to that key. Deleting the key in Lockbox cuts off ChatGPT right away.
- **AI Access page:** each key gets a "Copy MCP setup" button. It copies the MCP URL plus short steps for ChatGPT, Claude and Cursor. The existing ChatGPT/OpenAPI prompt stays.
- **Desktop app:** the same endpoint on its local AI address (`127.0.0.1`), for AI tools on that computer. ChatGPT on the web cannot reach it (same as today).

## Security (unchanged rules)
- Read-only. No send, delete or move tools.
- Every call checks the key. Keys are hashed, belong to one account, can be revoked and have rate limits.
- Redaction uses your saved hide rules on the server, never what the caller sends. Unreviewed mail is withheld.
- Access tokens from ChatGPT sign-in last a short time, are stored only as hashes and stop working when their key is deleted.
- Origin checks block browser pages on other websites. Responses are never cached.

## Technical details
- Add `connectors/ai-mcp.mjs`: a stateless MCP Streamable HTTP handler (JSON-RPC 2.0 over POST, protocol 2025-06-18). It handles `initialize`, `notifications/initialized`, `tools/list`, `tools/call` and `ping`. GET returns 405 and there is no session state. It reuses `buildFeed`/redaction from `connectors/ai-feed.mjs` and `verifyKey`. It is written by hand because the mail server is plain Node with no build step, and the endpoint only needs a few methods.
- Plug it into `createAiRoutes` so the server (`server/index.mjs`) and desktop (`desktop/main.mjs`) both serve it. The existing `/api/*` forwarding means no proxy change is needed.
- OAuth bridge for ChatGPT, in `server/mcp-oauth.mjs`:
  - Endpoints: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, dynamic client registration, `/api/ai/v1/oauth/authorize` (a page where you paste the key, with CSRF protection), and `/api/ai/v1/oauth/token` (PKCE S256 only, with refresh).
  - Tokens are stored hashed in encrypted `/data` and linked to the key id.
  - A 401 response includes a `WWW-Authenticate` header that points to the resource metadata.
  - Make sure the web container forwards `/.well-known/oauth-*` to the mail service (`src/lib/mail-forward.ts`, Caddyfile).
- UI: add a "Copy MCP setup" button next to each key in AI Access (`src/cypht/App.jsx`) and a prompt builder.
- Tests (vitest):
  - initialize and tools/list shape
  - a missing, wrong or deleted key gets 401
  - get_message returns redacted fields, and unreviewed mail is withheld
  - the OAuth flow needs PKCE, and its token dies when the key is deleted
  - the rate limit applies
- Docs: update `docs/` with connection steps for ChatGPT, Claude Desktop and Cursor. Record the decision in `AGENTS.md`.

## Not verifiable here
I can't test a live ChatGPT connection, Hostinger, or Claude/Cursor clients from here. I'll test locally with real MCP requests, then you redeploy and connect.
