// Loops: send an instruction to consoles on a schedule, when they go idle, or when
// their output matches. A loop retires itself once its stop condition is met.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const FILE = path.join(os.homedir(), '.vibeboard', 'loops.json')
const SHELL = process.env.SHELL || '/bin/zsh'
const COOLDOWN_MS = 10_000

const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`

export function createLoops({ sessions, sendPrompt, broadcast, run }) {
  const loops = new Map()
  const timers = new Map()
  const lastFire = new Map() // `${loopId}:${sessionId}` -> ts
  const tails = new Map() // same key -> recent output for regex triggers

  const publish = () => {
    fs.writeFileSync(FILE, JSON.stringify([...loops.values()], null, 2))
    broadcast({ type: 'loops', loops: list() })
  }

  const list = () => [...loops.values()]

  const targetsOf = (loop) => {
    const all = [...sessions.values()]
    return loop.target?.ids?.length ? all.filter((s) => loop.target.ids.includes(s.id)) : all
  }

  const targets = (loop, s) => (loop.target?.ids?.length ? loop.target.ids.includes(s.id) : true)

  async function goalMet(loop, sample) {
    const goal = loop.stop?.goal
    if (!goal) return false
    const cwd = sample?.cwd || os.homedir()
    if (goal.type === 'command' && goal.command) {
      const r = await run(SHELL, ['-lc', goal.command], { cwd, timeout: 10 * 60_000 })
      return r.code === 0
    }
    if (goal.type === 'judge' && goal.text) {
      const output = (sample?.buf || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').slice(-6000)
      const prompt = `You judge whether a coding agent reached its goal.\nGoal: ${goal.text}\n\nRecent console output:\n${output}\n\nAnswer with exactly YES or NO.`
      const r = await run(SHELL, ['-lic', `claude -p ${shq(prompt)}`], { cwd, timeout: 180_000 })
      return /^\s*YES\b/i.test(r.stdout)
    }
    return false
  }

  function finish(loop, reason) {
    clearInterval(timers.get(loop.id))
    timers.delete(loop.id)
    loop.active = false
    loop.finishedReason = reason
    publish()
  }

  async function fire(loop, only) {
    if (!loop.active || loop.firing) return
    loop.firing = true
    try {
      const list = only ? [only] : targetsOf(loop)
      if (await goalMet(loop, list[0])) return finish(loop, 'goal met')
      for (const s of list) sendPrompt(s, loop.instruction)
      loop.runs = (loop.runs || 0) + 1
      loop.lastRunAt = Date.now()
      if (loop.stop?.runs && loop.runs >= loop.stop.runs) return finish(loop, 'run limit')
      publish()
    } finally {
      loop.firing = false
    }
  }

  function overTime(loop) {
    if (loop.stop?.timeMs && Date.now() - loop.startedAt > loop.stop.timeMs) {
      finish(loop, 'time limit')
      return true
    }
    return false
  }

  function cooled(loop, s) {
    const key = `${loop.id}:${s.id}`
    const now = Date.now()
    if (now - (lastFire.get(key) || 0) < COOLDOWN_MS) return false
    lastFire.set(key, now)
    return true
  }

  function schedule(loop) {
    if (!loop.active || loop.trigger?.type !== 'schedule') return
    const every = Math.max(60_000, loop.trigger.everyMs || 0)
    timers.set(
      loop.id,
      setInterval(() => {
        if (!overTime(loop)) fire(loop)
      }, every),
    )
  }

  function add(input) {
    const loop = {
      id: crypto.randomUUID(),
      name: String(input.name || 'Loop').slice(0, 80),
      instruction: String(input.instruction || '').slice(0, 8000),
      trigger: input.trigger,
      target: input.target,
      stop: input.stop || {},
      runs: 0,
      startedAt: Date.now(),
      active: true,
    }
    if (!loop.instruction) throw new Error('instruction required')
    loops.set(loop.id, loop)
    schedule(loop)
    publish()
    return loop
  }

  function remove(id) {
    clearInterval(timers.get(id))
    timers.delete(id)
    loops.delete(id)
    publish()
    return { ok: true }
  }

  function onStatus(s, status) {
    for (const loop of loops.values()) {
      if (!loop.active || loop.trigger?.type !== 'idle' || !targets(loop, s)) continue
      if ((status === 'done' || status === 'idle') && !overTime(loop) && cooled(loop, s)) fire(loop, s)
    }
  }

  function onOutput(s, data) {
    for (const loop of loops.values()) {
      if (!loop.active || loop.trigger?.type !== 'output' || !loop.trigger.pattern || !targets(loop, s)) continue
      const key = `${loop.id}:${s.id}`
      const tail = ((tails.get(key) || '') + data).slice(-4000)
      tails.set(key, tail)
      let re
      try {
        re = new RegExp(loop.trigger.pattern, 'i')
      } catch {
        continue
      }
      if (re.test(tail.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')) && !overTime(loop) && cooled(loop, s)) {
        tails.set(key, '')
        fire(loop, s)
      }
    }
  }

  if (fs.existsSync(FILE)) {
    try {
      for (const l of JSON.parse(fs.readFileSync(FILE, 'utf8'))) {
        loops.set(l.id, l)
        schedule(l)
      }
    } catch (e) {
      console.error('loops.json unreadable, starting empty:', e.message)
    }
  }

  return { list, add, remove, onStatus, onOutput }
}
