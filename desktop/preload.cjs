"use strict";
const { contextBridge, ipcRenderer } = require("electron");
function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld(
  "vesperDesktop",
  Object.freeze({
    loadDraft: (workspaceId, conversationId) =>
      ipcRenderer.invoke("vesper:drafts:load", workspaceId, conversationId),
    saveDraft: (workspaceId, conversationId, draft) =>
      ipcRenderer.invoke(
        "vesper:drafts:save",
        workspaceId,
        conversationId,
        draft,
      ),
    loadConnection: () => ipcRenderer.invoke("vesper:connection:load"),
    saveConnection: (value) =>
      ipcRenderer.invoke("vesper:connection:save", value),
    createLocalWorkspace: () => ipcRenderer.invoke("vesper:local:create"),
    restartLocalHost: () => ipcRenderer.invoke("vesper:local:restart"),
    localHostStatus: () => ipcRenderer.invoke("vesper:local:status"),
    onLocalHostStatus: (callback) => subscribe("vesper:local:status", callback),
    onConnectionChanged: (callback) =>
      subscribe("vesper:connection:changed", callback),
  }),
);
