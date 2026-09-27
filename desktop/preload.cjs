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
    saveDraft: (workspaceId, conversationId, draft, revision) =>
      ipcRenderer.invoke(
        "vesper:drafts:save",
        workspaceId,
        conversationId,
        draft,
        revision,
      ),
    onDraftChanged: (callback) => subscribe("vesper:drafts:changed", callback),
    quickChatStatus: () => ipcRenderer.invoke("vesper:quick:status"),
    showQuickChat: () => ipcRenderer.invoke("vesper:quick:show"),
    hideQuickChat: () => ipcRenderer.invoke("vesper:quick:hide"),
    showMainWindow: () => ipcRenderer.invoke("vesper:main:show"),
    showSettings: (section = "general") =>
      ipcRenderer.invoke("vesper:settings:show", section),
    closeSettings: () => ipcRenderer.invoke("vesper:settings:close"),
    settingsSection: () => ipcRenderer.invoke("vesper:settings:section"),
    onSettingsSection: (callback) =>
      subscribe("vesper:settings:section", callback),
    setQuickShortcut: (accelerator) =>
      ipcRenderer.invoke("vesper:quick:shortcut", accelerator),
    onQuickStatus: (callback) => subscribe("vesper:quick:status", callback),
    onQuickFocus: (callback) => subscribe("vesper:quick:focus", callback),
    activeConversation: () => ipcRenderer.invoke("vesper:conversation:get"),
    setActiveConversation: (workspaceId, conversationId) =>
      ipcRenderer.invoke(
        "vesper:conversation:set",
        workspaceId,
        conversationId,
      ),
    onActiveConversation: (callback) =>
      subscribe("vesper:conversation:changed", callback),
    speechCommand: (command) =>
      ipcRenderer.invoke("vesper:speech:command", command),
    cancelSpeech: () => ipcRenderer.invoke("vesper:speech:cancel"),
    onSpeechEvent: (callback) => subscribe("vesper:speech:event", callback),
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
