// Repo scan: a throwaway, read-only CLI session in the repo folder proposes memory entries.
// Facts arrive one JSON object per line, so they land in the panel while the CLI writes them;
// nothing is saved until the user accepts them. One scan per repo; it outlives the panel.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const KINDS = ['Context', 'Architecture', 'Structure', 'Commands', 'Conventions', 'Gotchas']

export const PROMPT =
  'Describe this repository for a coding agent that is about to work in it: what the project is, how it is built, ' +
  'where things live, the commands, the conventions and the traps. Look at the file tree, the README and the docs first. ' +
  'Then write 8 to 14 facts, one per line, each line one JSON object ' +
  `{"kind": one of ${KINDS.map((k) => `"${k}"`).join(', ')}, "title": a few words, "text": 1-3 specific sentences}. ` +
  'Output only those lines: no prose, no numbering, no code fences.'

const q = (v) => `'${v.replace(/'/g, `'\\''`)}'`
// One non-interactive run per CLI. Claude streams JSON events (text as it is typed) and may only read.
// ponytail: only the Claude line is tried on this machine; the others follow each CLI's documented one-shot mode.
export const COMMANDS = {
  claude: (p) =>
    `claude -p ${q(p)} --model sonnet --output-format stream-json --verbose --include-partial-messages ` +
    '--no-session-persistence --setting-sources local --strict-mcp-config --allowedTools Read Glob Grep --disallowedTools Bash Edit Write NotebookEdit',
  codex: (p) => `codex exec --sandbox read-only --skip-git-repo-check ${q(p)}`,
  gemini: (p) => `gemini -p ${q(p)}`,
  grok: (p) => `grok -p ${q(p)}`,
  opencode: (p) => `opencode run ${q(p)}`,
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g

// The fact lines in `text`. Until the run ends the last line may be half written, so it waits.
export function parseFacts(text, final = false) {
  const lines = text.split('\n')
  if (!final) lines.pop()
  const facts = []
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*]\s+/, '').replace(/,$/, '')
    if (!line.startsWith('{')) continue // prose around the facts
    let f
    try {
      f = JSON.parse(line)
    } catch {
      continue // a line that only looks like JSON is not a fact either
    }
    if (typeof f?.title !== 'string' || typeof f?.text !== 'string' || !f.title.trim() || !f.text.trim()) continue
    facts.push({ kind: KINDS.includes(f.kind) ? f.kind : 'Context', title: f.title.trim().slice(0, 120), text: f.text.trim().slice(0, 1500) })
  }
  return facts
}

// Steps shown in the panel: 0 launch, 1 read the repo, 2 write facts, 3 wrap up.
export function createScans({ broadcast, launch, commands = COMMANDS, timeoutMs = 5 * 60_000 }) {
  const jobs = new Map() // repo path -> job
  const view = (j) => ({ id: j.id, cwd: j.cwd, agent: j.agent, startedAt: j.startedAt, step: j.step, facts: j.facts, status: j.status, error: j.error })
  const list = () => [...jobs.values()].map(view)
  const emit = () => broadcast({ type: 'scans', scans: list() })

  const kill = (child) => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // the group already exited
    }
  }

  function start(cwd, agent) {
    const command = commands[agent]
    if (!command) throw new Error(`${agent} cannot scan a repo yet`)
    if (jobs.get(cwd)?.status === 'running') throw new Error('this repo is already being scanned')
    const job = { id: crypto.randomUUID(), cwd, agent, startedAt: Date.now(), step: 0, facts: [], status: 'running', error: null }
    jobs.set(cwd, job)
    let text = '' // what the CLI has written so far
    let pending = '' // a stdout line still arriving
    let final = null // Claude's own last word, when it sends one
    let failure = null
    let errTail = ''
    const advance = (step) => step > job.step && ((job.step = step), true)
    const refresh = (isFinal = false) => {
      const facts = parseFacts(text, isFinal)
      const changed = facts.length !== job.facts.length
      if (changed) job.facts = facts
      return (facts.length > 0 && advance(2)) || changed
    }
    const onClaudeEvent = (e) => {
      if (e.type === 'stream_event' && e.event?.type === 'content_block_start' && e.event.content_block?.type === 'text') text += '\n'
      else if (e.type === 'stream_event' && e.event?.delta?.type === 'text_delta') {
        text += e.event.delta.text
        return refresh()
      } else if (e.type === 'assistant' && e.message?.content?.some((c) => c.type === 'tool_use')) return advance(1)
      else if (e.type === 'result') {
        if (e.is_error) failure = String(e.result ?? e.subtype).slice(0, 300)
        else final = String(e.result ?? '')
        return advance(3)
      }
      return false
    }

    const child = launch(command(PROMPT), cwd)
    job.child = child
    const timer = setTimeout(() => {
      failure = `no answer after ${Math.round(timeoutMs / 60_000)} minutes`
      kill(child)
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (job.cancelled) return
      let changed = false
      if (agent === 'claude') {
        const lines = (pending + chunk).split('\n')
        pending = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('{')) continue // shell rc noise
          try {
            changed = onClaudeEvent(JSON.parse(line)) || changed
          } catch {
            // a stray line that is not an event
          }
        }
      } else {
        text += chunk.replace(ANSI, '')
        changed = advance(1)
        changed = refresh() || changed
      }
      if (changed) emit()
    })
    child.stderr.on('data', (chunk) => (errTail = (errTail + chunk).slice(-2000)))
    child.on('error', (e) => (failure = e.message))
    child.on('close', (code) => {
      clearTimeout(timer)
      delete job.child
      if (job.cancelled) return
      if (final !== null && parseFacts(final, true).length >= job.facts.length) text = final
      refresh(true)
      job.step = 3
      job.status = job.facts.length ? 'done' : 'failed'
      if (!job.facts.length) job.error = failure || errTail.replace(ANSI, '').trim().split('\n').pop() || `${agent} exited with ${code} and proposed nothing`
      emit()
    })
    emit()
    return view(job)
  }

  // Cancel a running scan or drop its proposals once reviewed.
  function clear(cwd) {
    const job = jobs.get(cwd)
    if (!job) return
    job.cancelled = true
    if (job.child) kill(job.child)
    jobs.delete(cwd)
    emit()
  }

  return { list, start, clear }
}

// `node server/scan.mjs`: checks the parser and a whole run against a fake Claude.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assert = (await import('node:assert/strict')).default
  const fact = (title, kind = 'Commands') => JSON.stringify({ kind, title, text: `about ${title}` })
  assert.deepEqual(parseFacts(`Here you go\n${fact('a')}\n${fact('b', 'Weird')}\n{"kind":"Gotchas","ti`).map((f) => [f.kind, f.title]), [
    ['Commands', 'a'],
    ['Context', 'b'],
  ])
  assert.equal(parseFacts(`${fact('a')}\n${fact('c')}`, true).length, 2)

  const ev = (o) => JSON.stringify(o)
  const delta = (t) => ev({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } })
  const stream = [
    'shell noise',
    ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
    ev({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } }),
    delta(fact('one').slice(0, 10)),
    delta(fact('one').slice(10) + '\n' + fact('two')),
    ev({ type: 'result', is_error: false, result: `${fact('one')}\n${fact('two')}` }),
  ]
  const seen = []
  const scans = createScans({
    broadcast: (m) => seen.push(m.scans[0] && { ...m.scans[0] }),
    commands: { claude: () => `printf '%s\\n' ${stream.map(q).join(' ')}`, slow: () => 'sleep 30' },
    launch: (cmd, cwd) => spawn('/bin/sh', ['-c', cmd], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }),
  })
  scans.start(process.cwd(), 'claude')
  assert.throws(() => scans.start(process.cwd(), 'claude'), /already being scanned/)
  await new Promise((r) => setTimeout(r, 1500))
  const done = scans.list()[0]
  assert.equal(done.status, 'done')
  assert.deepEqual(done.facts.map((f) => f.title), ['one', 'two'])
  assert.equal(done.step, 3)
  assert.ok(seen.length >= 2) // started, then streamed or finished

  scans.start('/tmp', 'slow')
  scans.clear('/tmp')
  assert.equal(scans.list().length, 1)
  console.log('scan parsers ok')
}
