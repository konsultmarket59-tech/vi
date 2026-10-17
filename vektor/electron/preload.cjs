// Мост между окном и главным процессом: только узкий набор действий, без доступа к Node в странице.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vkHost", {
  desktop: true,
  platform: process.platform,
  pickFolder: (title) => ipcRenderer.invoke("fs:pickFolder", title),
  pickFiles: (opts) => ipcRenderer.invoke("fs:pickFiles", opts),
  saveDialog: (opts) => ipcRenderer.invoke("fs:saveDialog", opts),
  list: (dir) => ipcRenderer.invoke("fs:list", dir),
  read: (p) => ipcRenderer.invoke("fs:read", p),
  write: (p, data) => ipcRenderer.invoke("fs:write", p, data),
  reveal: (p) => ipcRenderer.invoke("fs:reveal", p),
  fetch: (req) => ipcRenderer.invoke("net:fetch", req),
  corelProbe: () => ipcRenderer.invoke("corel:probe"),
  corelNormalize: (p) => ipcRenderer.invoke("corel:normalize", p),
  corelBuild: (pages, output, version) => ipcRenderer.invoke("corel:build", pages, output, version),
});
