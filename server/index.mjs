// vibeboard local server: owns the PTYs (they outlive browser reloads),
// receives Claude Code hook events for console status, persists board state.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import pty from 'node-pty'
import { AGENTS, agentById } from '../shared/agents.js'
import { createLoops } from './loops.mjs'
import { readTranscript } from './transcript.mjs'

const PORT = Number(process.env.PORT) || 4317
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// VIBEBOARD_DATA runs a second, separate board (a demo, a test) without touching your real one.
const DATA_DIR = process.env.VIBEBOARD_DATA || path.join(os.homedir(), '.vibeboard')
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
        PostToolUse: [{ matcher: '*', hooks: [hook('PostToolUse')] }],
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
// The Vite dev page only in development: in production another project on :5173 must not drive the consoles.
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
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

const summary = (s) => ({ id: s.id, agent: s.agent.id, status: s.status, cwd: s.cwd, paused: s.paused, pid: s.pty.pid, subagents: [...s.subagents.values()] })

// Claude's own sub-agents (its Task/Agent tool) appear on its console while they run. PreToolUse
// opens one, PostToolUse closes it; only the last few finished ones are kept.
// ponytail: a background sub-agent's PostToolUse fires at launch, so it shows as done early.
const SUBAGENT_TOOLS = new Set(['Task', 'Agent'])
function trackSubagent(s, action, payload) {
  if (!SUBAGENT_TOOLS.has(payload.tool_name)) return
  const input = payload.tool_input || {}
  const task = String(input.description || input.prompt || '').slice(0, 140)
  const key = String(payload.tool_use_id || task)
  if (!key) return
  if (action === 'PreToolUse') {
    const type = String(input.name || input.subagent_type || 'general-purpose').slice(0, 60)
    s.subagents.set(key, { id: key, type, task, status: 'running', startedAt: Date.now() })
  } else if (action === 'PostToolUse' && s.subagents.has(key)) {
    s.subagents.set(key, { ...s.subagents.get(key), status: 'done', endedAt: Date.now() })
  } else return
  publishSubagents(s)
}

// The turn is over (Stop, or an interrupt noticed by the idle prompt): nothing is still running.
function settleSubagents(s) {
  let changed = false
  for (const [k, a] of s.subagents) {
    if (a.status !== 'running') continue
    s.subagents.set(k, { ...a, status: 'done', endedAt: Date.now() })
    changed = true
  }
  if (changed) publishSubagents(s)
}

function publishSubagents(s) {
  const done = [...s.subagents.values()].filter((a) => a.status === 'done')
  for (const a of done.slice(0, Math.max(0, done.length - 4))) s.subagents.delete(a.id)
  broadcast({ type: 'subagents', id: s.id, subagents: [...s.subagents.values()] })
}

function setStatus(s, status) {
  if (s.status === status) return
  s.status = status
  broadcast({ type: 'status', id: s.id, status })
  loops.onStatus(s, status)
}

// No `=` in the bare set: zsh expands a leading `=word` to a command path.
const shq = (v) => (/^[\w@%+:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`)

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
  // A project folder that has gone away must not quietly become $HOME (maybe in YOLO).
  if (cwd && !isDir(cwd)) throw new Error(`folder not found: ${cwd}`)
  const dir = cwd || os.homedir()
  // Agents run through a login+interactive shell so they see the same PATH as iTerm.
  const args = agent.cmd ? ['-lic', `exec ${commandFor(agent, { sessionId, resume, yolo })}`] : ['-l']
  const p = pty.spawn(SHELL, args, {
    name: 'xterm-256color',
    cols: cols || 100,
    rows: rows || 30,
    cwd: dir,
    env: { ...CLEAN_ENV, VIBEBOARD_ID: id, COLORTERM: 'truecolor', TERM_PROGRAM: 'vibeboard' },
  })
  const s = { id, agent, cwd: dir, pty: p, buf: '', status: 'idle', clients: new Set(), paused: false, idleTimer: null, quietUntil: 0, lastInputAt: 0, subagents: new Map() }
  p.onData((d) => {
    s.buf = s.buf.length + d.length > MAX_BUF ? (s.buf + d).slice(-MAX_BUF) : s.buf + d
    for (const c of s.clients) if (c.readyState === 1) c.send(d)
    // A repaint after a resize is not activity: it would flip status and re-match output triggers.
    if (Date.now() < s.quietUntil) return
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
    loops.onExit(s)
    for (const c of s.clients) c.close(4000, 'exit')
    broadcast({ type: 'exit', id, code: exitCode })
  })
  sessions.set(id, s)
  broadcast({ type: 'spawn', session: summary(s) })
  return s
}

// The agent's own process group plus every group its descendants live in: Claude's Bash tool
// and the dev servers it starts sit in groups of their own, out of reach of `kill(-pid)`.
function groupsOf(s, into = new Set()) {
  into.add(s.pty.pid)
  try {
    const kids = new Map()
    for (const line of execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).split('\n')) {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
      if (pid) kids.set(ppid, [...(kids.get(ppid) || []), { pid, pgid }])
    }
    const todo = [s.pty.pid]
    while (todo.length) {
      for (const k of kids.get(todo.pop()) || []) {
        into.add(k.pgid)
        todo.push(k.pid)
      }
    }
  } catch (e) {
    console.error('ps failed, signalling the agent group only:', e.message)
  }
  return into
}

const signalGroups = (groups, sig) => {
  for (const g of groups) {
    try {
      process.kill(-g, sig)
    } catch {}
  }
}

// Claude Code ignores SIGHUP, so escalate until the exit handler has removed the session.
// Groups are collected up front: once the agent dies its children reparent to launchd.
function kill(s) {
  const groups = groupsOf(s)
  signalGroups(groups, 'SIGCONT')
  signalGroups(groups, 'SIGHUP')
  setTimeout(() => sessions.get(s.id) === s && signalGroups(groupsOf(s, groups), 'SIGTERM'), 1500)
  setTimeout(() => sessions.get(s.id) === s && signalGroups(groups, 'SIGKILL'), 4000)
}

function signal(s, sig) {
  signalGroups(groupsOf(s), sig)
  s.paused = sig === 'SIGSTOP'
  broadcast({ type: 'paused', id: s.id, paused: s.paused })
}

const writeTo = (s, text) => s.pty.write(text)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Multi-line text goes in as a bracketed paste so each newline doesn't submit on its own;
// the Enter follows after a beat, or the TUI folds it into the paste. Prompts queue per
// console: two writers inside that beat would otherwise fuse into one prompt.
function sendPrompt(s, text) {
  s.queue = (s.queue || Promise.resolve()).then(async () => {
    writeTo(s, text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text)
    await sleep(120)
    writeTo(s, '\r')
    await sleep(150)
  })
  return s.queue
}

const dim = (v, max, fallback) => {
  const n = Number(v) | 0
  return n > 1 ? Math.min(max, n) : fallback
}

function resize(s, cols, rows) {
  if (sessions.get(s.id) !== s) return // node-pty's resize throws on a dead pty
  s.quietUntil = Date.now() + 1000
  s.pty.resize(cols, rows)
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
  const script = `for c in ${cmds.join(' ')}; do command -v $c >/dev/null 2>&1 && echo $c; done; true`
  const { code, stdout } = await runCommand(SHELL, ['-lic', script], { timeout: 10000 })
  const found = new Set(stdout.split('\n').map((l) => l.trim()))
  const ids = AGENTS.filter((a) => !a.cmd || found.has(a.cmd)).map((a) => a.id)
  if (code === 0) installed = ids // a slow .zshrc that timed out gets another try next time
  return ids
}

// `claude -p --output-format json` ends with one JSON line; anything before it is shell-rc noise.
async function askClaude(model, prompt, opts) {
  const r = await runCommand(SHELL, ['-lic', `claude -p --model ${model} --output-format json ${shq(prompt)}`], opts)
  let out
  try {
    out = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    throw new Error(r.code === 0 ? 'claude gave no reply' : `claude exited with ${r.code}`)
  }
  if (out.is_error || typeof out.result !== 'string') throw new Error(`claude failed: ${String(out.result ?? out.subtype).slice(0, 200)}`)
  return out.result
}

// ---------- hand-off: one agent's work, summarised, becomes the next agent's prompt ----------
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|[\x00-\x08\x0b-\x1f]/g
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')

// What the outgoing agent did. Claude's own transcript is clean text; any other CLI only has its
// screen, so that is used with the escape codes stripped (and has no final reply to quote).
function conversationText(s, max = 15000) {
  const file = s.transcript && path.resolve(s.transcript)
  if (file && file.startsWith(CLAUDE_PROJECTS + path.sep) && file.endsWith('.jsonl') && fs.existsSync(file)) {
    const { lines, lastReply } = readTranscript(fs.readFileSync(file, 'utf8').split('\n').slice(-400).join('\n'))
    if (lines.length) return { context: lines.join('\n').slice(-max), lastReply: lastReply.slice(0, 6000) }
  }
  return { context: s.buf.replace(ANSI, '').replace(/\n{3,}/g, '\n\n').slice(-max), lastReply: '' }
}

// The summary gives the next agent the story; the final reply goes in verbatim, because that is
// usually the deliverable itself (the plan, the findings) and a summary would paraphrase it away.
async function handoffBrief(s) {
  const { context, lastReply } = conversationText(s)
  const withReply = (brief) => (lastReply ? `${brief}\n\nTheir last message, word for word:\n\n${lastReply}` : brief)
  if (process.env.VIBEBOARD_NO_LLM) return withReply(context.slice(-2000)) // tests: no model call
  const prompt =
    'One coding agent is handing its work to another. From the session below, write the brief the next agent needs: ' +
    'the goal, what was done (files touched), the current state, open problems and the next steps. ' +
    'At most 180 words, plain text, no preamble.\n\nSession:\n' +
    context
  try {
    return withReply((await askClaude('haiku', prompt, { cwd: s.cwd, timeout: 120_000 })).trim())
  } catch (e) {
    console.error('hand-off summary failed, sending the raw tail:', e.message)
    return withReply(context.slice(-2000))
  }
}

const recentHandoffs = new Map() // `${from}>${to}` -> ts: two open tabs must not hand off twice

// The model may wrap its JSON in prose or a ```json fence.
function parseJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  for (const candidate of [text, fenced?.[1], text.slice(text.search(/[[{]/))]) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate.trim())
    } catch {}
  }
  throw new Error('no JSON in agent reply')
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
        const seen = new Set() // one line per content block, all carrying the same message usage
        for (const line of (await fs.promises.readFile(file, 'utf8')).split('\n')) {
          if (!line.includes('"usage"')) continue
          try {
            const e = JSON.parse(line)
            const u = e.message?.usage
            if (!u || !e.timestamp) continue
            const mid = e.message.id || e.requestId
            if (mid) {
              if (seen.has(mid)) continue
              seen.add(mid)
            }
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

function serveStatic(url, res) {
  const dist = path.join(ROOT, 'dist')
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)))
  if (file !== dist && !file.startsWith(dist + path.sep)) return json(res, 403, { error: 'forbidden' })
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  if (!fs.existsSync(file)) return json(res, 404, { error: 'run npm run build first' })
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  // The file can vanish between the check and the open while `npm run build` rewrites dist.
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

// ---------- HTTP API ----------
const server = http.createServer(async (req, res) => {
  if (!isAllowed(req)) return json(res, 403, { error: 'forbidden' })
  // Everything below runs inside the try: a malformed URL from any page (`/%`, `//`) must cost
  // one 400/500, not the process and every console it owns.
  try {
    const url = new URL(req.url, 'http://x')
    const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]
    if (parts[0] !== 'api') return serveStatic(url, res)
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
      const payload = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
      const s = sessions.get(id) // after the body: the console may have exited meanwhile
      if (s) {
        const idlePrompt = payload.notification_type === 'idle_prompt' || /waiting for your input/i.test(payload.message || '')
        if (payload.transcript_path) s.transcript = String(payload.transcript_path)
        trackSubagent(s, action, payload)
        if (action === 'UserPromptSubmit' || action === 'PreToolUse' || action === 'PostToolUse') setStatus(s, 'working')
        else if (action === 'Stop') {
          setStatus(s, 'done')
          settleSubagents(s)
        }
        // Auto-compact restarts the session mid-turn: the agent is still working.
        else if (action === 'SessionStart' && payload.source !== 'compact') setStatus(s, 'idle')
        else if (action === 'Notification' && !idlePrompt) setStatus(s, 'needs')
        // Esc interrupts fire no Stop; the 60s idle notice is what unsticks "working".
        else if (action === 'Notification' && s.status === 'working') {
          setStatus(s, 'idle')
          settleSubagents(s)
        }
        // `prompted` marks a conversation worth resuming: it has at least one prompt on disk.
        if (payload.session_id) broadcast({ type: 'session-id', id: s.id, sessionId: payload.session_id, prompted: action === 'UserPromptSubmit' })
      }
      return json(res, 200, { ok: true })
    }
    if (route === 'handoff' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 64 * 1024))
      const fromName = String(body.fromName || 'the previous agent').slice(0, 80)
      const toName = String(body.toName || 'the next agent').slice(0, 80)
      const from = sessions.get(body.from)
      const to = sessions.get(body.to)
      if (!from) return json(res, 409, { error: `${fromName} is not running` })
      if (!to) return json(res, 409, { error: `${toName} is not running` })
      if (from === to) return json(res, 400, { error: 'an agent cannot hand off to itself' })
      const key = `${from.id}>${to.id}`
      if (Date.now() - (recentHandoffs.get(key) || 0) < 20_000) return json(res, 200, { ok: true, duplicate: true })
      recentHandoffs.set(key, Date.now())
      broadcast({ type: 'handoff', from: from.id, to: to.id, state: 'summarizing' })
      const brief = await handoffBrief(from)
      if (sessions.get(to.id) !== to) {
        broadcast({ type: 'handoff', from: from.id, to: to.id, state: 'failed' })
        return json(res, 409, { error: `${toName} stopped before the hand-off arrived` })
      }
      const role = typeof body.role === 'string' && body.role.trim() ? `\n\nYour role: ${body.role.trim().slice(0, 500)}` : ''
      sendPrompt(to, `Hand-off from ${fromName}. Here is where they left off:\n\n${brief}${role}\n\nPick up from here.`)
      setStatus(to, 'working')
      broadcast({ type: 'handoff', from: from.id, to: to.id, state: 'sent' })
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
        if (body.prompt) {
          sendPrompt(s, String(body.prompt))
          setStatus(s, 'working') // not idle: that would let an idle loop type over this prompt
        } else {
          writeTo(s, String(body.data ?? ''))
          if (s.status === 'done') setStatus(s, 'idle')
        }
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
      // `open X.app` launches the app; a folder with an extension may be a bundle, so reveal it instead.
      await runCommand('open', path.extname(cwd) ? ['-R', cwd] : [cwd])
      return json(res, 200, { ok: true })
    }
    if (route === 'scan' && req.method === 'POST') {
      const { cwd } = JSON.parse(await readBody(req, 64 * 1024))
      if (!isDir(cwd)) return json(res, 400, { error: 'not a directory' })
      const prompt =
        'Read this repository and write the facts a coding agent must know before working here. ' +
        'Reply with ONLY a JSON array, no prose, of 4 to 10 objects {"kind": one of "Structure","Commands","Conventions","Gotchas", "title": short, "text": 1-3 sentences}.'
      try {
        const facts = parseJSON(await askClaude('sonnet', prompt, { cwd, timeout: 240_000 }))
        if (!Array.isArray(facts) || !facts.every((f) => f && typeof f.title === 'string' && typeof f.text === 'string'))
          throw new Error('scan reply has the wrong shape')
        return json(res, 200, facts)
      } catch (e) {
        return json(res, 502, { error: e.message })
      }
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
        '{"type":"handoff","from":"<console name>","to":"<console name>"}  (summarise one agent\'s work and give it to another)',
        '{"type":"pause"}  {"type":"resume"}',
        'There is no action to stop or delete a console: if asked, say it needs the close button. If the command is unclear, return no actions and ask in "reply".',
      ].join('\n')
      try {
        const plan = parseJSON(await askClaude('haiku', prompt, { cwd: os.homedir(), timeout: 120_000 }))
        if (!plan || typeof plan.reply !== 'string' || !Array.isArray(plan.actions)) throw new Error('planner reply has the wrong shape')
        return json(res, 200, plan)
      } catch (e) {
        return json(res, 502, { error: e.message })
      }
    }
    if (route === 'git') return json(res, 200, await gitInfo(url.searchParams.get('cwd')))
    if (route === 'usage') return json(res, 200, await usageStats())
    if (route === 'loops') {
      if (req.method === 'GET') return json(res, 200, loops.list())
      if (req.method === 'POST') {
        const input = JSON.parse(await readBody(req, 1024 * 1024))
        try {
          return json(res, 200, loops.add(input))
        } catch (e) {
          return json(res, 400, { error: e.message })
        }
      }
      if (req.method === 'DELETE' && id) return json(res, 200, loops.remove(id))
    }
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    if (res.headersSent) return res.destroy()
    return json(res, e instanceof URIError ? 400 : 500, { error: e instanceof URIError ? 'bad url' : 'server error' })
  }
})

// ---------- WebSockets ----------
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (!isAllowed(req)) return socket.destroy()
  socket.on('error', () => socket.destroy())
  wss.handleUpgrade(req, socket, head, (ws) => {
    // A broken frame emits 'error'; without a listener that throws and takes the server down.
    ws.on('error', () => ws.terminate())
    let url
    try {
      url = new URL(req.url, 'http://x')
    } catch {
      return ws.close()
    }
    if (url.pathname === '/ws/events') return attachEvents(ws)
    if (url.pathname === '/ws/pty') return attachPty(ws, url.searchParams)
    ws.close()
  })
})

// Terminal queries (device attributes, cursor and status reports, colour and mode queries) in a
// replayed buffer would be answered again by the fresh xterm, and the answers would reach the
// agent as keystrokes long after it asked.
const QUERIES =
  /\x1b\[[>=]?0?c|\x1b\[\??[0-9]*n|\x1b\[>[0-9]*q|\x1b\[\?u|\x1b\[\??[0-9;]*\$p|\x1b\[1[468]t|\x1bP\$q[^\x1b]*\x1b\\|\x1b\](?:1[0-2]|4;[0-9]+);\?(?:\x07|\x1b\\)/g

function attachEvents(ws) {
  eventClients.add(ws)
  ws.send(JSON.stringify({ type: 'sessions', sessions: [...sessions.values()].map(summary) }))
  ws.send(JSON.stringify({ type: 'loops', loops: loops.list() }))
  ws.on('close', () => eventClients.delete(ws))
}

function attachPty(ws, q) {
  const id = q.get('id')
  if (!id || !/^[\w-]{1,64}$/.test(id)) return ws.close()
  const cols = dim(q.get('cols'), 500, 100)
  const rows = dim(q.get('rows'), 300, 30)
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
    ws.send(s.buf.replace(QUERIES, ''))
  }
  s.clients.add(ws)
  // Nudge full-screen TUIs to repaint for the freshly attached view.
  resize(s, cols, Math.max(2, rows - 1))
  resize(s, cols, rows)
  ws.on('message', (raw) => {
    if (sessions.get(s.id) !== s) return // a message that arrives after the exit
    let m
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!m || typeof m !== 'object') return
    if (m.t === 'i' && typeof m.d === 'string') {
      s.pty.write(m.d)
      s.lastInputAt = Date.now()
      if (s.status === 'done') setStatus(s, 'idle')
    } else if (m.t === 'r') {
      const c = dim(m.cols, 500, 0)
      const r = dim(m.rows, 300, 0)
      if (c && r) resize(s, c, r)
    }
  })
  ws.on('close', () => s.clients.delete(ws))
}

server.listen(PORT, '127.0.0.1', () => console.log(`vibeboard server on http://127.0.0.1:${PORT}`))

// Give agents up to 3s to close their own tool shells, then kill whatever is left,
// so no console outlives the server that owns its PTY.
let stopping = false
const shutdown = () => {
  if (stopping) return
  stopping = true
  const groups = new Set()
  for (const s of sessions.values()) groupsOf(s, groups)
  signalGroups(groups, 'SIGCONT')
  signalGroups(groups, 'SIGHUP')
  signalGroups(groups, 'SIGTERM')
  const t0 = Date.now()
  const tick = setInterval(() => {
    if (sessions.size && Date.now() - t0 < 3000) return
    clearInterval(tick)
    signalGroups(groups, 'SIGKILL')
    process.exit(0)
  }, 100)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
// Last resort: an unexpected throw still takes the consoles down with us instead of orphaning them.
process.on('uncaughtException', (e) => {
  console.error('fatal:', e)
  shutdown()
})
process.on('unhandledRejection', (e) => {
  console.error('fatal:', e)
  shutdown()
})
