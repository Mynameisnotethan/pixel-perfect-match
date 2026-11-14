/** Paste-ready setup prompt for ChatGPT (Custom GPT Action) and skill-capable agents. Never contains the key. */
export function buildChatGptPrompt({ endpoint, keyName }) {
  const schema = `${endpoint}/openapi.json`;
  const local = /\/\/(127\.0\.0\.1|localhost)/.test(endpoint);
  return `Help me connect my Lockbox mailbox to you using the API key named "${keyName}". Do NOT ask me to paste the key into this chat.
${local ? `\nNote: this address (${endpoint}) only works on my own computer while Lockbox is open. ChatGPT on the web cannot reach it; use an agent running on this computer.\n` : ''}
1. Walk me through creating a Custom GPT: Explore GPTs > Create > Configure > Actions > Create new action.
2. Tell me to choose "Import from URL" and enter: ${schema}
3. Tell me to set Authentication to "API Key", Auth type "Bearer", and paste the "${keyName}" key there (it starts with lbx_).
4. Write these Instructions for the GPT:

---
You can read my Lockbox mailbox through the Lockbox actions (read-only).
- listMessages: list recent reviewed emails (use limit, up to 100; mailbox to filter).
- getMessage: read one email by id.
- Anything shown as [hidden: Label] was hidden by me. Never guess, infer, or ask for hidden content; you may mention its label (e.g. "Financial info").
- Only emails I have reviewed are shared. If something is missing, say it isn't shared rather than assuming it doesn't exist.
- You cannot send, delete, or change email.
---

5. If you support skills instead of Custom GPTs and have internet access, create a skill named "lockbox-mailbox" with the instructions above that calls GET ${endpoint}/messages and GET ${endpoint}/messages/{id} with header "Authorization: Bearer <key>", reading the key from a secret/environment variable, never from chat.

API description: ${schema}`;
}

/** Setup steps for MCP clients (ChatGPT apps, Claude, Cursor). Never contains the key. */
export function buildMcpSetup({ endpoint, keyName }) {
  const url = `${endpoint}/mcp`;
  const local = /\/\/(127\.0\.0\.1|localhost)/.test(endpoint);
  return `Lockbox MCP server (read-only, reviewed emails only; hidden parts show as [hidden: Label])
URL: ${url}
Key: the "${keyName}" key (starts with lbx_). Never paste it into a chat.
${local ? `\nThis address only works on this computer while Lockbox is open, so ChatGPT on the web cannot use it.\n` : `
ChatGPT: Settings > Apps & Connectors > Create (Developer mode). Paste the URL, choose OAuth, then Create. A Lockbox page opens: paste the key there and click Allow.
`}
Claude Desktop / Cursor / other MCP clients: add a remote (Streamable HTTP) server with the URL and the header
  Authorization: Bearer <your lbx_ key>

Cursor example (~/.cursor/mcp.json):
{ "mcpServers": { "lockbox": { "url": "${url}", "headers": { "Authorization": "Bearer \${env:LOCKBOX_KEY}" } } } }

Tools: list_messages (limit, mailbox), get_message (id). Deleting the key in Lockbox disconnects every app using it.`;
}
