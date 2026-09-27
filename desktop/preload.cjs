"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "vesperDesktop",
  Object.freeze({
    loadConnection: () => ipcRenderer.invoke("vesper:connection:load"),
    saveConnection: (value) =>
      ipcRenderer.invoke("vesper:connection:save", value),
  }),
);
