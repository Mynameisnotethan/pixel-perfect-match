// Pure helpers for the Connect an Agent wizard. Nothing here ever receives or returns an API key.
import { normalizePerms } from '../../connectors/ai-perms.mjs';

export const PROVIDERS = {
  chatgpt: { id: 'chatgpt', name: 'ChatGPT', keyName: 'ChatGPT', docs: 'https://developers.openai.com/api/docs/guides/custom-mcp-server' },
  claude: { id: 'claude', name: 'Claude', keyName: 'Claude', docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp' },
  grok: { id: 'grok', name: 'Grok — API setup', keyName: 'Grok API', docs: 'https://docs.x.ai/developers/tools/remote-mcp' },
};
export const STEPS = ['Assistant', 'Access', 'Connection', 'Configure', 'Verify', 'Try it', 'Done'];

/** MCP address from the installation's public URL (or the API base it serves). Never hardcoded. */
export function mcpUrlFrom(base) {
  const b = String(base || '').trim().replace(/\/+$/, '').replace(/\/api\/ai\/v1(\/mcp)?$/, '');
  return b ? `${b}/api/ai/v1/mcp` : '';
}
export const isLocalUrl = u => /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(u);

export const TEST_PROMPT = 'Use Lockbox’s get_access tool and tell me the key name, connected mailboxes, and whether reading, drafts, and direct sending are enabled.';
export function tryPrompts(perms) {
  const p = normalizePerms(perms);
  const out = [];
  if (p.read) out.push({ id: 'list', label: 'List recent emails', text: 'Use Lockbox to list my 5 most recent emails with sender, subject and date.' });
  if (p.drafts) out.push({ id: 'draft', label: 'Create a self-addressed test draft', text: 'Use Lockbox to create a draft addressed to my own mailbox address with the subject "Lockbox test" and the body "This is a test from my assistant." Tell me the draft id and version. Do not send it.' });
  if (p.send) {
    out.push({ id: 'send', label: 'Send that draft', text: 'Use Lockbox to send the "Lockbox test" draft you just created, using its exact draft id and version.' });
    out.push({ id: 'schedule', label: 'Schedule a test for five minutes from now', text: 'Use Lockbox to create another draft to my own address with the subject "Lockbox scheduled test", then schedule it for five minutes from now using a timestamp with my time zone.' });
  }
  return out;
}

/** Verification evidence, only from what the server recorded after the wizard opened. */
export function evidence({ reachable, key, since }) {
  const after = t => !!t && (!since || Date.parse(t) >= since);
  return {
    reachable: reachable === true ? 'ok' : reachable === false ? 'fail' : 'unknown',
    authenticated: key && after(key.lastUsedAt) ? 'ok' : 'unknown',
    toolCalled: key && after(key.lastToolCallAt) ? 'ok' : 'unknown',
  };
}

export function grokSample(url) {
  return `# pip install openai   (xAI's API is OpenAI-compatible)
import os
from openai import OpenAI

client = OpenAI(api_key=os.environ["XAI_API_KEY"], base_url="https://api.x.ai/v1")

response = client.responses.create(
    model="grok-4",  # any current Grok model that supports tools
    input="Use Lockbox's get_access tool and tell me the key name, connected mailboxes, and whether reading, drafts, and direct sending are enabled.",
    tools=[{
        "type": "mcp",
        "server_label": "lockbox",
        "server_url": "${url}",
        "authorization": os.environ["LOCKBOX_KEY"],  # your lbx_ key; sent as the Authorization header
    }],
)
print(response.output_text)`;
}
export const bearerConfig = url => `{ "mcpServers": { "lockbox": { "url": "${url}", "headers": { "Authorization": "Bearer \${env:LOCKBOX_KEY}" } } } }`;

/** Wizard progress kept in this tab's session storage — the secret key is stripped. */
const SKEY = 'lockbox:agent-wizard';
export const saveProgress = st => { try { const { secret, ...rest } = st || {}; sessionStorage.setItem(SKEY, JSON.stringify(rest)); } catch {} };
export const loadProgress = () => { try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch { return null; } };
export const clearProgress = () => { try { sessionStorage.removeItem(SKEY); } catch {} };
