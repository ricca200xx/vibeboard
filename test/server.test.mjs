// End-to-end check of the local server: run with `npm test`.
// Starts its own server on another port with a throwaway HOME, so real state is never touched.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const PORT = 4399
const BASE = `http://127.0.0.1:${PORT}`
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeboard-test-'))
let server

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = (method, url, body, headers = {}) =>
  fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
const sessions = async () => (await api('GET', '/api/sessions')).json()
const until = async (fn, ms = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await fn()) return true
    await sleep(150)
  }
  return false
}
const openShell = (id, cwd = HOME) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=${id}&agent=shell&cwd=${encodeURIComponent(cwd)}&cols=80&rows=24`, { origin: 'http://localhost:5173' })
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
const tail = async (id) => (await (await api('POST', `/api/pty/${id}/tail`, { chars: 4000 })).json()).text

before(async () => {
  // Pretend the server was launched from inside a Claude Code session.
  const env = { ...process.env, PORT: String(PORT), HOME, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1' }
  server = spawn(process.execPath, ['server/index.mjs'], { env, stdio: 'ignore' })
  assert.ok(await until(async () => (await fetch(BASE + '/api/sessions').catch(() => null))?.ok), 'server did not start')
})

after(() => {
  server.kill('SIGTERM')
  fs.rmSync(HOME, { recursive: true, force: true })
})

test('rejects foreign origins and hosts', async () => {
  assert.equal((await api('GET', '/api/sessions', undefined, { origin: 'https://evil.example' })).status, 403)
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=x&agent=shell`, { origin: 'https://evil.example' })
  const err = await new Promise((r) => ws.on('error', r))
  assert.ok(err)
})

test('serves the built app and refuses path traversal', { skip: !fs.existsSync('dist/index.html') && 'run npm run build first' }, async () => {
  assert.match(await (await fetch(BASE + '/')).text(), /<div id="root">/)
  assert.match(await (await fetch(BASE + '/some/client/route')).text(), /<div id="root">/, 'SPA fallback')
  // A plain ".." is normalised by the URL parser; "..%2f" survives it and only becomes "../" once decoded.
  const status = await new Promise((resolve) =>
    http.get({ host: '127.0.0.1', port: PORT, path: '/..%2fdist-evil/x' }, (res) => resolve(res.statusCode)),
  )
  assert.equal(status, 403)
})

test('state round-trips and garbage is refused', async () => {
  assert.equal((await api('PUT', '/api/state', { projects: [], active: null })).status, 200)
  assert.deepEqual(await (await api('GET', '/api/state')).json(), { projects: [], active: null })
  const bad = await fetch(BASE + '/api/state', { method: 'PUT', body: '{not json' })
  assert.equal(bad.status, 500)
  assert.deepEqual(await (await api('GET', '/api/state')).json(), { projects: [], active: null })
})

test('shell console runs commands and hooks drive status', async () => {
  const ws = await openShell('t-shell')
  await sleep(800)
  ws.send(JSON.stringify({ t: 'i', d: 'echo VB_$((40+2))_[$CLAUDECODE$CLAUDE_CODE_CHILD_SESSION]\r' }))
  assert.ok(await until(async () => (await tail('t-shell')).includes('VB_42_[]')), 'echo output missing or Claude session env leaked into the console')

  const status = async () => (await sessions()).find((s) => s.id === 't-shell')?.status
  await api('POST', '/api/hook/t-shell/UserPromptSubmit', {})
  // Shell has no hooks of its own; activity may flip it, so only check the hook-driven transitions.
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'permission_prompt', message: 'needs permission' })
  assert.equal(await status(), 'needs')
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(await status(), 'needs', 'idle_prompt must not change status')
  await api('POST', '/api/hook/t-shell/Stop', {})
  assert.equal(await status(), 'done')
  ws.close()
})

test('kill escalates past processes that ignore SIGHUP', async () => {
  const ws = await openShell('t-stubborn')
  await sleep(800)
  // exec: the PTY's own process becomes one that ignores SIGHUP and SIGTERM, exactly like Claude Code.
  ws.send(JSON.stringify({ t: 'i', d: `exec node -e "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1e3)"\r` }))
  await sleep(1200)
  await api('DELETE', '/api/pty/t-stubborn')
  assert.ok(await until(async () => !(await sessions()).some((s) => s.id === 't-stubborn'), 9000), 'console survived kill')
  ws.close()
})

test('idle loop fires once and retires at its run limit', async () => {
  const ws = await openShell('t-loop')
  await sleep(3500) // let the shell settle to idle
  const loop = await (await api('POST', '/api/loops', { instruction: 'echo LOOP_FIRED', trigger: { type: 'idle' }, target: { ids: ['t-loop'] }, stop: { runs: 1 } })).json()
  ws.send(JSON.stringify({ t: 'i', d: 'echo poke\r' })) // activity -> working -> idle triggers the loop
  assert.ok(await until(async () => (await tail('t-loop')).includes('LOOP_FIRED'), 10000), 'loop never fired')
  const loops = await (await api('GET', '/api/loops')).json()
  const l = loops.find((x) => x.id === loop.id)
  assert.equal(l.active, false)
  assert.equal(l.finishedReason, 'run limit')
  await api('DELETE', `/api/loops/${loop.id}`)
  await api('DELETE', '/api/pty/t-loop')
  ws.close()
})

test('an "all consoles" loop stays inside its own project', async () => {
  const other = fs.mkdtempSync(path.join(HOME, 'other-'))
  const mine = await openShell('t-mine')
  const theirs = await openShell('t-theirs', other)
  await sleep(3500)
  const loop = await (await api('POST', '/api/loops', { instruction: 'echo SCOPED_FIRE', trigger: { type: 'idle' }, target: {}, scope: HOME, stop: { runs: 2 } })).json()
  mine.send(JSON.stringify({ t: 'i', d: 'echo poke\r' }))
  theirs.send(JSON.stringify({ t: 'i', d: 'echo poke\r' }))
  assert.ok(await until(async () => (await tail('t-mine')).includes('SCOPED_FIRE'), 10000), 'loop never reached its own project')
  await sleep(1500)
  assert.ok(!(await tail('t-theirs')).includes('SCOPED_FIRE'), 'loop leaked into another project')
  await api('DELETE', `/api/loops/${loop.id}`)
  await api('DELETE', '/api/pty/t-mine')
  await api('DELETE', '/api/pty/t-theirs')
  mine.close()
  theirs.close()
})
