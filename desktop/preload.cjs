// Exposes mailbox actions to the Lockbox UI. Tokens never cross into the renderer.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lockboxMailboxes', {
  runtime: 'desktop',
  list: () => ipcRenderer.invoke('mailbox:list'),
  connect: provider => ipcRenderer.invoke('mailbox:connect', provider),
  sync: id => ipcRenderer.invoke('mailbox:sync', id),
  send: (id, msg) => ipcRenderer.invoke('mailbox:send', id, msg),
  disconnect: id => ipcRenderer.invoke('mailbox:disconnect', id),
});
