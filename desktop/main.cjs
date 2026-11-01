// vibeboard as a macOS app: starts the local server (with the system's Node, so node-pty needs no
// Electron rebuild), then shows the board in a real window. Web tiles become real browsers here:
// pages that refuse to be framed (Google, GitHub…) load, because the window strips the headers that
// forbid framing, for frames only.
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const PORT = Number(process.env.PORT) || 4317
const ORIGIN = `http://127.0.0.1:${PORT}`
const ROOT = path.join(__dirname, '..')
let server = null

const alive = () =>
  new Promise((resolve) => {
    const req = http.get(`${ORIGIN}/api/state`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => req.destroy())
  })

// A server already running on the port (npm run dev, a second window) is reused, not doubled.
async function ensureServer() {
  if (await alive()) return
  const shell = process.env.SHELL || '/bin/zsh'
  server = spawn(shell, ['-lic', 'exec node server/index.mjs'], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) }, stdio: 'inherit' })
  server.on('exit', (code) => {
    server = null
    if (code) console.error(`vibeboard server exited with ${code}`)
  })
  for (let i = 0; i < 80; i++) {
    if (await alive()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`the vibeboard server did not start on port ${PORT}`)
}

// Frames only: the app's own page keeps every protection it has.
function allowFraming() {
  session.defaultSession.webRequest.onHeadersReceived((details, done) => {
    if (details.resourceType !== 'subFrame') return done({})
    const headers = { ...details.responseHeaders }
    for (const key of Object.keys(headers)) {
      const k = key.toLowerCase()
      if (k === 'x-frame-options') delete headers[key]
      else if (k === 'content-security-policy') headers[key] = headers[key].map((v) => v.replace(/frame-ancestors[^;]*;?/gi, ''))
    }
    done({ responseHeaders: headers })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: 'vibeboard',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161617' : '#f5f5f7',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    show: !process.env.VIBEBOARD_DESKTOP_HIDDEN, // tests drive a hidden window over CDP
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  // Links meant for a new window ("Open in your browser") go to the real browser; nothing else opens.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // The board never navigates away from itself.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault()
  })
  win.loadURL(ORIGIN)
  return win
}

ipcMain.on('inspect', (e, x, y) => {
  e.sender.inspectElement(Math.round(Number(x) || 0), Math.round(Number(y) || 0))
})

// The traffic lights and native dialogs follow the theme chosen in Settings.
ipcMain.on('theme', (_e, mode) => {
  if (['system', 'light', 'dark'].includes(mode)) nativeTheme.themeSource = mode
})

ipcMain.handle('pick-folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  return canceled ? null : filePaths[0]
})

app.setName('vibeboard')
app.whenReady().then(async () => {
  allowFraming()
  try {
    await ensureServer()
  } catch (err) {
    console.error(err.message)
    app.quit()
    return
  }
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => app.quit())
app.on('quit', () => server?.kill('SIGTERM'))
