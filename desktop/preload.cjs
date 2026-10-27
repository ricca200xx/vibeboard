// What the board may ask of the desktop app: nothing beyond opening the inspector on a point.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vibeboardDesktop', {
  inspect: (x, y) => ipcRenderer.send('inspect', x, y),
})
