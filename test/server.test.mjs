// End-to-end check of the local server: run with `npm test`.
// Starts its own server on another port with a throwaway HOME, so real state is never touched.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { readTranscript } from '../server/transcript.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
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
  const env = { ...process.env, PORT: String(PORT), HOME, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', VIBEBOARD_NO_LLM: '1' }
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.mjs')], { env, stdio: 'ignore' })
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

test('malformed URLs and hostile WebSocket messages do not take the server down', async () => {
  const get = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => resolve(res.statusCode)).on('error', () => resolve(0)))
  assert.equal(await get('/%'), 400)
  assert.ok((await get('//')) >= 400)
  const ws = await openShell('t-hostile')
  await sleep(500)
  ws.send('null')
  ws.send('[1]')
  ws.send(JSON.stringify({ t: 'r', cols: -5, rows: 'x' }))
  // Re-attach to the live session with nonsense dimensions.
  const again = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=t-hostile&agent=shell&cols=-5&rows=0`, { origin: 'http://localhost:5173' })
  await new Promise((r) => again.on('open', r))
  await sleep(300)
  assert.ok((await sessions()).some((s) => s.id === 't-hostile'), 'server died or lost the console')
  await api('DELETE', '/api/pty/t-hostile')
  ws.close()
  again.close()
})

test('a console for a folder that is gone is refused, not opened in $HOME', { timeout: 5000 }, async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=t-gone&agent=shell&cwd=${encodeURIComponent(path.join(HOME, 'no-such-dir'))}`, { origin: 'http://localhost:5173' })
  let text = ''
  ws.on('message', (d) => (text += d))
  await new Promise((r) => ws.on('close', r))
  assert.match(text, /folder not found/)
  assert.ok(!(await sessions()).some((s) => s.id === 't-gone'))
})

test('an account profile name cannot point outside the profiles folder', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/pty?id=t-prof&agent=shell&cwd=${encodeURIComponent(HOME)}&profile=..%2F..%2Fetc`, { origin: 'http://localhost:5173' })
  let said = ''
  ws.on('message', (m) => (said += m))
  await new Promise((r) => ws.on('close', r))
  assert.match(said, /bad profile name/)
  assert.ok(!(await sessions()).some((s) => s.id === 't-prof'))
})

test('prompts sent back to back reach the console as separate prompts', async () => {
  const ws = await openShell('t-queue')
  await sleep(800)
  await Promise.all([api('POST', '/api/pty/t-queue/input', { prompt: 'echo QA_$((1+1))' }), api('POST', '/api/pty/t-queue/input', { prompt: 'echo QB_$((2+2))' })])
  assert.ok(await until(async () => /QA_2\s[\s\S]*QB_4/.test(await tail('t-queue'))), 'both prompts should run')
  assert.ok(!(await tail('t-queue')).includes('QA_2echo'), 'prompts fused into one line')
  await api('DELETE', '/api/pty/t-queue')
  ws.close()
})

test('loop input is validated', async () => {
  const bad = [
    { instruction: 'x', trigger: { type: 'idle' }, target: { ids: [] } }, // empty pick must not mean "everyone"
    { instruction: 'x', trigger: { type: 'schedule', everyMs: null } },
    { instruction: 'x', trigger: { type: 'output', pattern: '(' } },
    { instruction: 'fix the failed tests', trigger: { type: 'output', pattern: 'failed' } }, // would re-fire on its own echo
  ]
  for (const loop of bad) assert.equal((await api('POST', '/api/loops', loop)).status, 400, JSON.stringify(loop))
})

test('serves the built app and refuses path traversal', { skip: !fs.existsSync(path.join(ROOT, 'dist/index.html')) && 'run npm run build first' }, async () => {
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
  await sleep(2700) // let the shell's own output-activity timer settle first
  await api('POST', '/api/hook/t-shell/UserPromptSubmit', {})
  await api('POST', '/api/hook/t-shell/SessionStart', { source: 'compact' })
  assert.equal(await status(), 'working', 'auto-compact happens mid-turn: still working')
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(await status(), 'idle', 'the idle notice unsticks a working console after an Esc interrupt')
  // Shell has no hooks of its own; activity may flip it, so only check the hook-driven transitions.
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'permission_prompt', message: 'needs permission' })
  assert.equal(await status(), 'needs')
  await api('POST', '/api/hook/t-shell/Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  assert.equal(await status(), 'needs', 'idle_prompt must not change status')
  await api('POST', '/api/hook/t-shell/Stop', {})
  assert.equal(await status(), 'done')
  ws.close()
})

test("Claude's sub-agents show on their console while they run", async () => {
  const ws = await openShell('t-subs')
  await sleep(300)
  const subs = async () => (await sessions()).find((s) => s.id === 't-subs')?.subagents ?? []
  const task = { tool_name: 'Agent', tool_use_id: 'toolu_1', tool_input: { description: 'Find the auth code', subagent_type: 'Explore', prompt: '...' } }
  await api('POST', '/api/hook/t-subs/PreToolUse', task)
  await api('POST', '/api/hook/t-subs/PreToolUse', { ...task, tool_use_id: 'toolu_2', tool_input: { description: 'Write tests' } })
  await api('POST', '/api/hook/t-subs/PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_3', tool_input: { command: 'ls' } })
  assert.deepEqual((await subs()).map((a) => [a.type, a.task, a.status]), [
    ['Explore', 'Find the auth code', 'running'],
    ['general-purpose', 'Write tests', 'running'],
  ])
  await api('POST', '/api/hook/t-subs/PostToolUse', task)
  assert.deepEqual((await subs()).map((a) => a.status), ['done', 'running'])
  await api('POST', '/api/hook/t-subs/Stop', {}) // the turn is over: nothing is left running
  assert.ok((await subs()).every((a) => a.status === 'done'))
  await api('DELETE', '/api/pty/t-subs')
  ws.close()
})

test('a hand-off carries one console\'s work to another as a prompt', async () => {
  const a = await openShell('t-from')
  const b = await openShell('t-to')
  await sleep(800)
  a.send(JSON.stringify({ t: 'i', d: 'echo WORK_$((20+3))_DONE\r' }))
  assert.ok(await until(async () => (await tail('t-from')).includes('WORK_23_DONE')))
  const handoff = (body) => api('POST', '/api/handoff', { from: 't-from', to: 't-to', fromName: 'Maya', toName: 'Otto', ...body })
  assert.equal((await handoff({})).status, 200)
  // The brief arrives as one bracketed paste; the shell echoes it back.
  assert.ok(await until(async () => /Hand-off from Maya[\s\S]*WORK_23_DONE/.test(await tail('t-to'))), 'brief never reached the next console')
  assert.equal((await (await handoff({})).json()).duplicate, true, 'a second tab firing the same hand-off is ignored')
  assert.equal((await handoff({ to: 'nope', toName: 'Ghost' })).status, 409)
  await api('DELETE', '/api/pty/t-from')
  await api('DELETE', '/api/pty/t-to')
  a.close()
  b.close()
})

test('a lead creates a helper on the board, gives it work and gets its answer back', { timeout: 30000 }, async () => {
  const lead = await openShell('t-lead')
  const rpc = (body) => api('POST', '/mcp/t-lead', { jsonrpc: '2.0', ...body })
  const mcp = async (method, params) => (await (await rpc({ id: 1, method, params })).json()).result
  const call = (name, args) => mcp('tools/call', { name, arguments: args })
  assert.equal((await mcp('initialize', { protocolVersion: '2025-06-18' })).serverInfo.name, 'vibeboard')
  assert.equal((await rpc({ method: 'notifications/initialized' })).status, 202)
  assert.ok((await mcp('tools/list')).tools.some((t) => t.name === 'create_helper'))

  const unseen = await call('create_helper', { name: 'Echo', task: 'x', agent: 'shell' })
  assert.ok(unseen.isError && /window is closed/.test(unseen.content[0].text), 'with no window open nobody would see the helper')

  const events = new WebSocket(`ws://127.0.0.1:${PORT}/ws/events`, { origin: 'http://localhost:5173' })
  const seen = []
  events.on('message', (m) => seen.push(JSON.parse(String(m))))
  await new Promise((r) => events.on('open', r))
  const made = await call('create_helper', { name: 'Echo', task: 'echo HELPER_$((40+2))', agent: 'shell' })
  assert.ok(!made.isError, made.content[0].text)
  const helper = seen.find((e) => e.type === 'helper')
  assert.deepEqual([helper?.parent, helper?.name], ['t-lead', 'Echo'], 'the board is told where to draw it')
  const answer = await call('wait_for_helpers', { timeout_seconds: 15 })
  assert.match(answer.content[0].text, /^Echo: idle[\s\S]*HELPER_42/)
  assert.ok((await call('message_helper', { name: 'Nobody', text: 'hi' })).isError)
  await api('DELETE', `/api/pty/${helper.id}`)
  await api('DELETE', '/api/pty/t-lead')
  events.close()
  lead.close()
})

test("a hand-off quotes the agent's final reply, not just a summary of it", () => {
  const jsonl = [
    { type: 'user', message: { content: 'Write a 3-line plan' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look first.' }, { type: 'tool_use', name: 'Read', input: { file: 'a.js' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '1. add.js\n2. export add\n3. test it' }] } },
    'not json',
  ]
    .map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))
    .join('\n')
  const { lines, lastReply } = readTranscript(jsonl)
  assert.equal(lastReply, '1. add.js\n2. export add\n3. test it')
  assert.equal(lines.length, 4)
  assert.equal(readTranscript(jsonl + '\n' + JSON.stringify({ type: 'user', message: { content: 'next' } })).lastReply, '', 'a newer prompt has no reply yet')
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
  // An in-flight flag on disk would freeze the loop forever after a restart.
  assert.ok(!fs.readFileSync(path.join(HOME, '.vibeboard', 'loops.json'), 'utf8').includes('"firing"'), 'runtime state persisted')
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
  // The console goes idle again inside the 10s cooldown: that trigger must be deferred, not dropped.
  const finished = async () => (await (await api('GET', '/api/loops')).json()).find((x) => x.id === loop.id)?.finishedReason === 'run limit'
  assert.ok(await until(finished, 16000), 'second run never came: trigger inside the cooldown was dropped')
  assert.ok(!(await tail('t-theirs')).includes('SCOPED_FIRE'), 'loop leaked into another project')
  await api('DELETE', `/api/loops/${loop.id}`)
  await api('DELETE', '/api/pty/t-mine')
  await api('DELETE', '/api/pty/t-theirs')
  mine.close()
  theirs.close()
})
