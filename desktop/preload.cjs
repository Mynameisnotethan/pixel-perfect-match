// Exposes mailbox actions to the Lockbox UI. Tokens never cross into the renderer.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lockboxMailboxes', {
  runtime: 'desktop',
  list: () => ipcRenderer.invoke('mailbox:list'),
  connect: provider => ipcRenderer.invoke('mailbox:connect', provider),
  sync: id => ipcRenderer.invoke('mailbox:sync', id),
  attachment: (id, msgId, attId) => ipcRenderer.invoke('mailbox:attachment', id, msgId, attId),
  send: (id, msg) => ipcRenderer.invoke('mailbox:send', id, msg),
  imap: { test: s => ipcRenderer.invoke('mailbox:imapTest', s), save: s => ipcRenderer.invoke('mailbox:imapSave', s) },
  disconnect: id => ipcRenderer.invoke('mailbox:disconnect', id),
  aiKeys: { list: () => ipcRenderer.invoke('aiKeys:list'), create: name => ipcRenderer.invoke('aiKeys:create', name), remove: id => ipcRenderer.invoke('aiKeys:remove', id) },
  privacy: { get: () => ipcRenderer.invoke('privacy:get'), put: body => ipcRenderer.invoke('privacy:put', body) },
  aiEndpoint: () => ipcRenderer.invoke('ai:endpoint'),
  // Renderer data is encrypted and compressed by the main process; plaintext never crosses the bridge.
  store: {
    get: (key, fallback) => ipcRenderer.invoke('store:get', key, fallback),
    put: (key, value) => ipcRenderer.invoke('store:put', key, value),
    remove: keys => ipcRenderer.invoke('store:remove', keys),
  },
});
