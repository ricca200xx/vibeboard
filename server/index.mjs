// vibeboard local server: owns the PTYs (they outlive browser reloads),
// receives Claude Code hook events for console status, persists board state.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import pty from 'node-pty'
import { AGENTS, agentById } from '../shared/agents.js'
import { createLoops } from './loops.mjs'

const PORT = Number(process.env.PORT) || 4317
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA_DIR = path.join(os.homedir(), '.vibeboard')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const HOOKS_FILE = path.join(DATA_DIR, 'claude-hooks.json')
const SHELL = process.env.SHELL || '/bin/zsh'
const MAX_BUF = 512 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

fs.mkdirSync(DATA_DIR, { recursive: true })

// When the server itself is started from a Claude Code terminal, its session variables
// (child-session marker, session id, messaging token) must not leak into the consoles:
// a Claude that thinks it is a child session stops saving transcripts, which breaks resume.
const STRIP_ENV = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_JOB_DIR$|CLAUDE_PID$)/
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !STRIP_ENV.test(k)))

// Claude Code gets these hooks through --settings, so the user's global config stays untouched.
const hook = (event) => ({
  type: 'command',
  command: `curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${PORT}/api/hook/$VIBEBOARD_ID/${event} >/dev/null 2>&1 || true`,
})
fs.writeFileSync(
  HOOKS_FILE,
  JSON.stringify(
    {
      hooks: {
        SessionStart: [{ hooks: [hook('SessionStart')] }],
        UserPromptSubmit: [{ hooks: [hook('UserPromptSubmit')] }],
        PreToolUse: [{ matcher: '*', hooks: [hook('PreToolUse')] }],
        Notification: [{ hooks: [hook('Notification')] }],
        Stop: [{ hooks: [hook('Stop')] }],
      },
    },
    null,
    2,
  ),
)

// ---------- security: only our own pages may talk to us ----------
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])
// Browsers always send Origin on cross-site WS/POST; curl (the hooks) sends none.
// The Host check blocks DNS-rebinding pages that resolve to 127.0.0.1.
const isAllowed = (req) => {
  const origin = req.headers.origin
  if (origin && !ALLOWED_ORIGINS.has(origin)) return false
  return ALLOWED_HOSTS.has(req.headers.host)
}

// ---------- sessions ----------
const sessions = new Map() // id -> session
const eventClients = new Set()

const broadcast = (msg) => {
  const s = JSON.stringify(msg)
  for (const c of eventClients) if (c.readyState === 1) c.send(s)
}

const summary = (s) => ({ id: s.id, agent: s.agent.id, status: s.status, cwd: s.cwd, paused: s.paused, pid: s.pty.pid })

function setStatus(s, status) {
  if (s.status === status) return
  s.status = status
  broadcast({ type: 'status', id: s.id, status })
  loops.onStatus(s, status)
}

const shq = (v) => (/^[\w@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`)

function commandFor(agent, { sessionId, resume, yolo }) {
  const parts = [agent.cmd]
  if (agent.id === 'claude') {
    if (resume && UUID.test(resume)) parts.push('--resume', resume)
    else if (sessionId && UUID.test(sessionId)) parts.push('--session-id', sessionId)
    parts.push('--settings', HOOKS_FILE)
    if (yolo) parts.push('--dangerously-skip-permissions')
  } else if (agent.id === 'codex' && yolo) {
    parts.push('--dangerously-bypass-approvals-and-sandbox')
  }
  return parts.map(shq).join(' ')
}

function spawnSession({ id, agentId, cwd, cols, rows, sessionId, resume, yolo }) {
  const agent = agentById(agentId)
  if (!agent) throw new Error(`unknown agent ${agentId}`)
  const dir = cwd && path.isAbsolute(cwd) && fs.existsSync(cwd) ? cwd : os.homedir()
  // Agents run through a login+interactive shell so they see the same PATH as iTerm.
  const args = agent.cmd ? ['-lic', `exec ${commandFor(agent, { sessionId, resume, yolo })}`] : ['-l']
  const p = pty.spawn(SHELL, args, {
    name: 'xterm-256color',
    cols: cols || 100,
    rows: rows || 30,
    cwd: dir,
    env: { ...CLEAN_ENV, VIBEBOARD_ID: id, COLORTERM: 'truecolor', TERM_PROGRAM: 'vibeboard' },
  })
  const s = { id, agent, cwd: dir, pty: p, buf: '', status: 'idle', clients: new Set(), paused: false, idleTimer: null }
  p.onData((d) => {
    s.buf = s.buf.length + d.length > MAX_BUF ? (s.buf + d).slice(-MAX_BUF) : s.buf + d
    for (const c of s.clients) if (c.readyState === 1) c.send(d)
    loops.onOutput(s, d)
    // Agents without hooks: status from output activity.
    if (!agent.hooks) {
      setStatus(s, 'working')
      clearTimeout(s.idleTimer)
      s.idleTimer = setTimeout(() => setStatus(s, 'idle'), 2500)
    }
  })
  p.onExit(({ exitCode }) => {
    clearTimeout(s.idleTimer)
    sessions.delete(id)
    for (const c of s.clients) c.close(4000, 'exit')
    broadcast({ type: 'exit', id, code: exitCode })
  })
  sessions.set(id, s)
  broadcast({ type: 'spawn', session: summary(s) })
  return s
}

const signalGroup = (s, sig) => {
  try {
    process.kill(-s.pty.pid, sig)
  } catch {}
}

// Claude Code ignores SIGHUP, so escalate on the whole group (its MCP servers included)
// until the exit handler has removed the session.
function kill(s) {
  signalGroup(s, 'SIGCONT')
  signalGroup(s, 'SIGHUP')
  setTimeout(() => sessions.get(s.id) === s && signalGroup(s, 'SIGTERM'), 1500)
  setTimeout(() => sessions.get(s.id) === s && signalGroup(s, 'SIGKILL'), 4000)
}

function signal(s, sig) {
  // Negative pid = whole process group, so tool subprocesses pause with the agent.
  process.kill(-s.pty.pid, sig)
  s.paused = sig === 'SIGSTOP'
  broadcast({ type: 'paused', id: s.id, paused: s.paused })
}

const writeTo = (s, text) => s.pty.write(text)

// Multi-line text goes in as a bracketed paste so each newline doesn't submit on its own;
// the Enter follows after a beat, or the TUI folds it into the paste.
function sendPrompt(s, text) {
  writeTo(s, text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text)
  setTimeout(() => writeTo(s, '\r'), 120)
}

const loops = createLoops({ sessions, sendPrompt, broadcast, run: runCommand })

// ---------- helpers ----------
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024, env: CLEAN_ENV, ...opts }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    )
  })
}

let installed = null
async function detectAgents() {
  const cmds = AGENTS.filter((a) => a.cmd).map((a) => a.cmd)
  const script = `for c in ${cmds.join(' ')}; do command -v $c >/dev/null 2>&1 && echo $c; done`
  const { stdout } = await runCommand(SHELL, ['-lic', script], { timeout: 10000 })
  const found = new Set(stdout.split('\n').map((l) => l.trim()))
  installed = AGENTS.filter((a) => !a.cmd || found.has(a.cmd)).map((a) => a.id)
  return installed
}
detectAgents()

const readBody = (req, limit = 20 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

const isDir = (p) => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isDirectory()

async function gitInfo(cwd) {
  if (!isDir(cwd)) return null
  const branch = await runCommand('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch.code !== 0) return null
  const [status, log, remote] = await Promise.all([
    runCommand('git', ['-C', cwd, 'status', '--porcelain']),
    runCommand('git', ['-C', cwd, 'log', '-n', '15', '--format=%h%x1f%s%x1f%an%x1f%cr']),
    runCommand('git', ['-C', cwd, 'remote', 'get-url', 'origin']),
  ])
  return {
    branch: branch.stdout.trim(),
    changes: status.stdout.split('\n').filter(Boolean).length,
    remote: remote.code === 0 ? remote.stdout.trim() : null,
    commits: log.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, subject, author, when] = l.split('\x1f')
        return { hash, subject, author, when }
      }),
  }
}

// Claude Code writes one JSONL per session; tokens per day come straight from there.
// Async and cached per file (mtime+size), so a big log folder never stalls the PTYs.
const usageCache = new Map() // file -> { key, days }
async function usageStats() {
  const base = path.join(os.homedir(), '.claude', 'projects')
  const days = {}
  let total = 0
  const since = Date.now() - 365 * 864e5
  if (!fs.existsSync(base)) return { days, total }
  for (const proj of await fs.promises.readdir(base)) {
    const dir = path.join(base, proj)
    if (!(await fs.promises.stat(dir)).isDirectory()) continue
    for (const f of await fs.promises.readdir(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const file = path.join(dir, f)
      const st = await fs.promises.stat(file)
      if (st.mtimeMs < since) continue
      const key = `${st.mtimeMs}:${st.size}`
      let entry = usageCache.get(file)
      if (entry?.key !== key) {
        const perFile = {}
        for (const line of (await fs.promises.readFile(file, 'utf8')).split('\n')) {
          if (!line.includes('"usage"')) continue
          try {
            const e = JSON.parse(line)
            const u = e.message?.usage
            if (!u || !e.timestamp) continue
            const day = e.timestamp.slice(0, 10)
            perFile[day] = (perFile[day] || 0) + (u.input_tokens || 0) + (u.output_tokens || 0)
          } catch {}
        }
        entry = { key, days: perFile }
        usageCache.set(file, entry)
      }
      for (const [day, n] of Object.entries(entry.days)) {
        days[day] = (days[day] || 0) + n
        total += n
      }
    }
  }
  return { days, total }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }

function serveStatic(req, res) {
  const dist = path.join(ROOT, 'dist')
  const url = new URL(req.url, 'http://x')
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)))
  if (file !== dist && !file.startsWith(dist + path.sep)) return json(res, 403, { error: 'forbidden' })
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  if (!fs.existsSync(file)) return json(res, 404, { error: 'run npm run build first' })
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

// ---------- HTTP API ----------
const server = http.createServer(async (req, res) => {
  if (!isAllowed(req)) return json(res, 403, { error: 'forbidden' })
  const url = new URL(req.url, 'http://x')
  const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]
  if (parts[0] !== 'api') return serveStatic(req, res)
  try {
    const [, route, id, action] = parts
    if (route === 'state' && req.method === 'GET') {
      return json(res, 200, fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {})
    }
    if (route === 'state' && req.method === 'PUT') {
      const body = await readBody(req)
      JSON.parse(body) // reject garbage before it overwrites good state
      fs.writeFileSync(STATE_FILE + '.tmp', body)
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE)
      return json(res, 200, { ok: true })
    }
    if (route === 'sessions') return json(res, 200, [...sessions.values()].map(summary))
    if (route === 'agents') return json(res, 200, installed ?? (await detectAgents()))
    if (route === 'hook' && req.method === 'POST') {
      const s = sessions.get(id)
      const payload = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
      if (s) {
        if (action === 'UserPromptSubmit' || action === 'PreToolUse') setStatus(s, 'working')
        else if (action === 'Stop') setStatus(s, 'done')
        else if (action === 'SessionStart') setStatus(s, 'idle')
        else if (action === 'Notification' && payload.notification_type !== 'idle_prompt' && !/waiting for your input/i.test(payload.message || ''))
          setStatus(s, 'needs')
        // `prompted` marks a conversation worth resuming: it has at least one prompt on disk.
        if (payload.session_id) broadcast({ type: 'session-id', id: s.id, sessionId: payload.session_id, prompted: action === 'UserPromptSubmit' })
      }
      return json(res, 200, { ok: true })
    }
    if (route === 'pty' && id) {
      const s = sessions.get(id)
      if (!s) return json(res, 404, { error: 'no such console' })
      if (req.method === 'DELETE') {
        kill(s)
        return json(res, 200, { ok: true })
      }
      const body = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
      if (action === 'input') {
        if (body.prompt) sendPrompt(s, String(body.prompt))
        else writeTo(s, String(body.data ?? ''))
        if (s.status === 'done') setStatus(s, 'idle')
        return json(res, 200, { ok: true })
      }
      if (action === 'signal' && (body.signal === 'SIGSTOP' || body.signal === 'SIGCONT')) {
        signal(s, body.signal)
        return json(res, 200, { ok: true })
      }
      if (action === 'tail') return json(res, 200, { text: s.buf.slice(-(Number(body.chars) || 8000)) })
    }
    if (route === 'ls') {
      const dir = url.searchParams.get('path') || os.homedir()
      if (!isDir(dir)) return json(res, 400, { error: 'not a directory' })
      const dirs = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b))
      return json(res, 200, { path: dir, parent: path.dirname(dir), home: os.homedir(), dirs, isRepo: fs.existsSync(path.join(dir, '.git')) })
    }
    if (route === 'claude-session' && id && UUID.test(id)) {
      const base = path.join(os.homedir(), '.claude', 'projects')
      const exists = fs.existsSync(base) && fs.readdirSync(base).some((d) => fs.existsSync(path.join(base, d, `${id}.jsonl`)))
      return json(res, 200, { exists })
    }
    if (route === 'reveal' && req.method === 'POST') {
      const { cwd } = JSON.parse(await readBody(req, 64 * 1024))
      if (!isDir(cwd)) return json(res, 400, { error: 'not a directory' })
      await runCommand('open', [cwd])
      return json(res, 200, { ok: true })
    }
    if (route === 'scan' && req.method === 'POST') {
      const { cwd } = JSON.parse(await readBody(req, 64 * 1024))
      if (!isDir(cwd)) return json(res, 400, { error: 'not a directory' })
      const prompt =
        'Read this repository and write the facts a coding agent must know before working here. ' +
        'Reply with ONLY a JSON array, no prose, of 4 to 10 objects {"kind": one of "Structure","Commands","Conventions","Gotchas", "title": short, "text": 1-3 sentences}.'
      const r = await runCommand(SHELL, ['-lic', `claude -p --model sonnet ${shq(prompt)}`], { cwd, timeout: 240_000 })
      const match = r.stdout.match(/\[[\s\S]*\]/)
      if (!match) return json(res, 502, { error: 'no JSON in agent reply' })
      return json(res, 200, JSON.parse(match[0]))
    }
    if (route === 'plan' && req.method === 'POST') {
      const { command, board } = JSON.parse(await readBody(req, 512 * 1024))
      const prompt = [
        'You are the planner of a visual board of coding-agent consoles. Turn the user command into board actions.',
        `Board: ${JSON.stringify(board)}`,
        `Command: ${JSON.stringify(String(command))}`,
        'Reply with ONLY a JSON object: {"reply": "<one short sentence to say back, in the language of the command>", "actions": [...]}.',
        'Allowed actions:',
        '{"type":"send","to":["<console name, group label, or all>"],"text":"<prompt to type into those consoles>"}',
        '{"type":"spawn","agent":"<one of board.agents>","count":<1-12>,"group":"<optional new group label>"}',
        '{"type":"group","names":["<console names>"],"label":"<group label>"}',
        '{"type":"frame","names":["<console names or group labels>"]}',
        '{"type":"pause"}  {"type":"resume"}',
        'There is no action to stop or delete a console: if asked, say it needs the close button. If the command is unclear, return no actions and ask in "reply".',
      ].join('\n')
      const r = await runCommand(SHELL, ['-lic', `claude -p --model haiku ${shq(prompt)}`], { cwd: os.homedir(), timeout: 120_000 })
      const match = r.stdout.match(/\{[\s\S]*\}/)
      if (!match) return json(res, 502, { error: 'planner gave no JSON' })
      return json(res, 200, JSON.parse(match[0]))
    }
    if (route === 'git') return json(res, 200, await gitInfo(url.searchParams.get('cwd')))
    if (route === 'usage') return json(res, 200, await usageStats())
    if (route === 'loops') {
      if (req.method === 'GET') return json(res, 200, loops.list())
      if (req.method === 'POST') return json(res, 200, loops.add(JSON.parse(await readBody(req, 1024 * 1024))))
      if (req.method === 'DELETE' && id) return json(res, 200, loops.remove(id))
    }
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    return json(res, 500, { error: 'server error' })
  }
})

// ---------- WebSockets ----------
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (!isAllowed(req)) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/ws/events') return attachEvents(ws)
    if (url.pathname === '/ws/pty') return attachPty(ws, url.searchParams)
    ws.close()
  })
})

function attachEvents(ws) {
  eventClients.add(ws)
  ws.send(JSON.stringify({ type: 'sessions', sessions: [...sessions.values()].map(summary) }))
  ws.send(JSON.stringify({ type: 'loops', loops: loops.list() }))
  ws.on('close', () => eventClients.delete(ws))
}

function attachPty(ws, q) {
  const id = q.get('id')
  if (!id || !/^[\w-]{1,64}$/.test(id)) return ws.close()
  const cols = Number(q.get('cols')) || 100
  const rows = Number(q.get('rows')) || 30
  let s = sessions.get(id)
  if (!s) {
    try {
      s = spawnSession({
        id,
        agentId: q.get('agent') || 'shell',
        cwd: q.get('cwd'),
        cols,
        rows,
        sessionId: q.get('sessionId'),
        resume: q.get('resume'),
        yolo: q.get('yolo') === '1',
      })
    } catch (e) {
      ws.send(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`)
      return ws.close()
    }
  } else if (s.buf) {
    ws.send(s.buf)
  }
  s.clients.add(ws)
  // Nudge full-screen TUIs to repaint for the freshly attached view.
  s.pty.resize(cols, Math.max(2, rows - 1))
  s.pty.resize(cols, rows)
  ws.on('message', (raw) => {
    let m
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (m.t === 'i' && typeof m.d === 'string') {
      s.pty.write(m.d)
      if (s.status === 'done') setStatus(s, 'idle')
    } else if (m.t === 'r' && m.cols > 1 && m.rows > 1) {
      s.pty.resize(Math.min(500, m.cols | 0), Math.min(300, m.rows | 0))
    }
  })
  ws.on('close', () => s.clients.delete(ws))
}

server.listen(PORT, '127.0.0.1', () => console.log(`vibeboard server on http://127.0.0.1:${PORT}`))

const shutdown = () => {
  for (const s of sessions.values()) {
    signalGroup(s, 'SIGCONT')
    signalGroup(s, 'SIGTERM')
  }
  setTimeout(() => {
    for (const s of sessions.values()) signalGroup(s, 'SIGKILL')
    process.exit(0)
  }, 1200)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
