// Loops: send an instruction to consoles on a schedule, when they go idle, or when
// their output matches. A loop retires itself once its stop condition is met.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const FILE = path.join(process.env.VIBEBOARD_DATA || path.join(os.homedir(), '.vibeboard'), 'loops.json')
const SHELL = process.env.SHELL || '/bin/zsh'
const COOLDOWN_MS = 10_000
const TYPING_MS = 5_000 // no loop types into a console the user touched this recently
const ECHO_MS = 2_000 // output right after a fire is the echo of our own instruction
const MAX_TIMER = 2 ** 31 - 1 // setTimeout/setInterval treat anything larger as 1ms

const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export function createLoops({ sessions, sendPrompt, broadcast, run }) {
  const loops = new Map()
  const timers = new Map()
  // Runtime only, never persisted; all keyed `${loopId}:${sessionId}`.
  const lastFire = new Map()
  const tails = new Map() // recent output for regex triggers
  const inFlight = new Set() // goal check or prompt under way
  const deferred = new Map() // trigger that landed in the cooldown or while the user was typing

  const keyOf = (loop, s) => `${loop.id}:${s.id}`
  const forget = (match) => {
    for (const m of [lastFire, tails, deferred]) {
      for (const k of m.keys()) {
        if (!match(k)) continue
        if (m === deferred) clearTimeout(m.get(k))
        m.delete(k)
      }
    }
  }

  const list = () => [...loops.values()]

  const publish = () => {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(list(), null, 2))
    fs.renameSync(FILE + '.tmp', FILE)
    broadcast({ type: 'loops', loops: list() })
  }

  // "All consoles" means all consoles of the loop's project (scope = project folder), never other boards.
  const targets = (loop, s) => (loop.target?.ids ? loop.target.ids.includes(s.id) : !loop.scope || s.cwd === loop.scope)
  const targetsOf = (loop) => [...sessions.values()].filter((s) => targets(loop, s))
  const settled = (s) => s.status === 'idle' || s.status === 'done'

  async function goalMet(loop, sample) {
    const goal = loop.stop?.goal
    if (!goal) return false
    const cwd = sample.cwd
    if (goal.type === 'command' && goal.command) {
      const r = await run(SHELL, ['-lic', goal.command], { cwd, timeout: 10 * 60_000 })
      return r.code === 0
    }
    if (goal.type === 'judge' && goal.text) {
      const output = (sample.buf || '').replace(ANSI, '').slice(-6000)
      const prompt = `You judge whether a coding agent reached its goal.\nGoal: ${goal.text}\n\nRecent console output:\n${output}\n\nAnswer with exactly YES or NO.`
      const r = await run(SHELL, ['-lic', `claude -p --model haiku ${shq(prompt)}`], { cwd, timeout: 180_000 })
      // The last line is the answer; anything above it is shell-rc noise.
      return /^\s*YES\b/i.test(r.stdout.trim().split('\n').pop() || '')
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

  async function fire(loop, candidates) {
    const list = candidates.filter((s) => !inFlight.has(keyOf(loop, s)))
    if (!loop.active || !list.length) return
    for (const s of list) inFlight.add(keyOf(loop, s))
    try {
      const met = await goalMet(loop, list[0])
      // The goal check can take minutes: the loop may be gone and the consoles may have moved on.
      if (loops.get(loop.id) !== loop || !loop.active) return
      if (met) return finish(loop, 'goal met')
      const live = list.filter((s) => sessions.get(s.id) === s && !s.paused && (loop.trigger?.type !== 'idle' || settled(s)))
      if (!live.length) return // nothing was sent, so this does not count as a run
      for (const s of live) {
        lastFire.set(keyOf(loop, s), Date.now())
        tails.delete(keyOf(loop, s))
        sendPrompt(s, loop.instruction)
      }
      loop.runs = (loop.runs || 0) + 1
      loop.lastRunAt = Date.now()
      if (loop.stop?.runs && loop.runs >= loop.stop.runs) return finish(loop, 'run limit')
      publish()
    } catch (e) {
      console.error(`loop ${loop.id} failed to fire:`, e)
    } finally {
      for (const s of list) inFlight.delete(keyOf(loop, s))
    }
  }

  function overTime(loop) {
    if (loop.stop?.timeMs && Date.now() - loop.startedAt > loop.stop.timeMs) {
      finish(loop, 'time limit')
      return true
    }
    return false
  }

  // Idle and output triggers that land inside the cooldown, or while the user is typing, are
  // deferred rather than dropped: a fast agent would otherwise stall the loop for good. If the
  // user types after the trigger, they have taken over and the deferred fire is dropped.
  function trigger(loop, s, since = Date.now()) {
    const key = keyOf(loop, s)
    clearTimeout(deferred.get(key))
    deferred.delete(key)
    if (!loop.active || overTime(loop) || s.lastInputAt > since) return
    const wait = Math.max((lastFire.get(key) || 0) + COOLDOWN_MS, (s.lastInputAt || 0) + TYPING_MS) - Date.now()
    if (wait <= 0) return fire(loop, [s])
    deferred.set(
      key,
      setTimeout(() => {
        deferred.delete(key)
        if (sessions.get(s.id) === s && (loop.trigger?.type !== 'idle' || settled(s))) trigger(loop, s, since)
      }, wait),
    )
  }

  function schedule(loop) {
    if (!loop.active || loop.trigger?.type !== 'schedule') return
    timers.set(
      loop.id,
      setInterval(() => {
        if (!overTime(loop)) fire(loop, targetsOf(loop))
      }, Math.min(MAX_TIMER, Math.max(60_000, Number(loop.trigger.everyMs) || 0))),
    )
  }

  function validate(input) {
    const instruction = String(input.instruction || '').slice(0, 8000)
    if (!instruction.trim()) throw new Error('instruction required')
    const t = input.trigger || {}
    let trigger
    if (t.type === 'schedule') {
      if (!Number.isFinite(t.everyMs)) throw new Error('schedule needs everyMs')
      trigger = { type: 'schedule', everyMs: Math.min(MAX_TIMER, Math.max(60_000, t.everyMs)) }
    } else if (t.type === 'idle') {
      trigger = { type: 'idle' }
    } else if (t.type === 'output') {
      const pattern = String(t.pattern || '')
      if (!pattern) throw new Error('output trigger needs a pattern')
      let re
      try {
        re = new RegExp(pattern, 'i')
      } catch {
        throw new Error('pattern is not a valid regular expression')
      }
      // The console echoes the instruction back: a pattern it matches would re-fire forever.
      if (re.test(instruction)) throw new Error('pattern matches the instruction itself, so the loop would trigger itself')
      trigger = { type: 'output', pattern }
    } else throw new Error('trigger must be schedule, idle or output')
    let target = {}
    if (input.target?.ids !== undefined) {
      const ids = input.target.ids
      if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === 'string')) throw new Error('pick at least one console')
      target = { ids }
    }
    const s = input.stop || {}
    const stop = {}
    if (s.runs !== undefined) {
      if (!Number.isInteger(s.runs) || s.runs < 1) throw new Error('stop.runs must be a positive whole number')
      stop.runs = s.runs
    }
    if (s.timeMs !== undefined) {
      if (!Number.isFinite(s.timeMs) || s.timeMs <= 0) throw new Error('stop.timeMs must be positive')
      stop.timeMs = s.timeMs
    }
    if (s.goal) {
      if (s.goal.type === 'command' && typeof s.goal.command === 'string' && s.goal.command.trim()) stop.goal = { type: 'command', command: s.goal.command }
      else if (s.goal.type === 'judge' && typeof s.goal.text === 'string' && s.goal.text.trim()) stop.goal = { type: 'judge', text: s.goal.text }
      else throw new Error('goal needs a command or a description')
    }
    return { instruction, trigger, target, stop }
  }

  function add(input) {
    const loop = {
      id: crypto.randomUUID(),
      name: String(input.name || 'Loop').slice(0, 80),
      ...validate(input),
      scope: typeof input.scope === 'string' ? input.scope : undefined,
      runs: 0,
      startedAt: Date.now(),
      active: true,
    }
    loops.set(loop.id, loop)
    schedule(loop)
    publish()
    return loop
  }

  function remove(id) {
    clearInterval(timers.get(id))
    timers.delete(id)
    loops.delete(id)
    forget((k) => k.startsWith(`${id}:`))
    publish()
    return { ok: true }
  }

  function onStatus(s, status) {
    if (!settled(s)) return
    // A hooked agent goes done -> idle when the user types into it: that is not the agent finishing.
    if (s.agent?.hooks && status === 'idle' && Date.now() - (s.lastInputAt || 0) < 1000) return
    for (const loop of loops.values()) {
      if (loop.active && loop.trigger?.type === 'idle' && targets(loop, s)) trigger(loop, s)
    }
  }

  function onOutput(s, data) {
    for (const loop of loops.values()) {
      if (!loop.active || loop.trigger?.type !== 'output' || !targets(loop, s)) continue
      const key = keyOf(loop, s)
      if (Date.now() - (lastFire.get(key) || 0) < ECHO_MS) continue
      const tail = ((tails.get(key) || '') + data).slice(-4000)
      tails.set(key, tail)
      let re
      try {
        re = new RegExp(loop.trigger.pattern, 'i')
      } catch {
        continue
      }
      if (re.test(tail.replace(ANSI, ''))) {
        tails.set(key, '')
        trigger(loop, s)
      }
    }
  }

  const onExit = (s) => forget((k) => k.endsWith(`:${s.id}`))

  if (fs.existsSync(FILE)) {
    try {
      for (const l of JSON.parse(fs.readFileSync(FILE, 'utf8'))) {
        delete l.firing // older builds persisted this in-flight flag, which froze the loop after a restart
        loops.set(l.id, l)
        schedule(l)
      }
    } catch (e) {
      console.error('loops.json unreadable, starting empty:', e.message)
    }
  }

  return { list, add, remove, onStatus, onOutput, onExit }
}
