import { useState } from 'react'
import { Clock, Crosshair, LayoutGrid, ListChecks, Moon, Plus, Repeat, ScanText, SquareTerminal, Trash2, X } from 'lucide-react'
import { api, type Loop } from '../api'
import { consoles, project, useStore, workspace } from '../store'

type Trigger = 'schedule' | 'idle' | 'output'
const INTERVALS: [string, number][] = [
  ['5 min', 5],
  ['10 min', 10],
  ['15 min', 15],
  ['30 min', 30],
  ['1 h', 60],
  ['2 h', 120],
]

export function LoopsModal() {
  const loops = useStore((s) => s.loops)
  const [creating, setCreating] = useState(loops.length === 0)
  const close = () => useStore.getState().set({ modal: null })

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow">
        <div className="modal-head">
          <span className="ico">
            <Repeat size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Loops</h2>
            <div className="sub">Send an instruction on a schedule, on idle or on output. A loop retires itself once its goal is met.</div>
          </div>
          {!creating && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New loop
            </button>
          )}
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body nowheel">{creating ? <LoopForm onDone={() => setCreating(false)} /> : <LoopList loops={loops} />}</div>
      </div>
    </div>
  )
}

function LoopList({ loops }: { loops: Loop[] }) {
  const describe = (l: Loop) =>
    l.trigger.type === 'schedule' ? `every ${Math.round(l.trigger.everyMs / 60000)} min` : l.trigger.type === 'idle' ? 'when an agent goes idle' : `when output contains “${l.trigger.pattern}”`
  return (
    <div className="loops">
      {loops.map((l) => (
        <div key={l.id} className="loop-row">
          <span className="dot" style={{ background: l.active ? 'var(--working)' : 'var(--faint)' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.instruction}</div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {describe(l)} · {l.runs} run{l.runs === 1 ? '' : 's'} · {l.active ? 'active' : `finished (${l.finishedReason})`}
            </div>
          </span>
          <button className="icon-btn" title="Delete loop" onClick={() => api.removeLoop(l.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}

function LoopForm({ onDone }: { onDone: () => void }) {
  const nodes = useStore((s) => workspace(s)?.nodes)
  const all = consoles(nodes ?? [])
  const [instruction, setInstruction] = useState('')
  const [trigger, setTrigger] = useState<Trigger>('schedule')
  const [minutes, setMinutes] = useState(15)
  const [pattern, setPattern] = useState('')
  const [pick, setPick] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [runsOn, setRunsOn] = useState(false)
  const [runs, setRuns] = useState(10)
  const [timeOn, setTimeOn] = useState(false)
  const [hours, setHours] = useState(2)
  const [goalOn, setGoalOn] = useState(true)
  const [goalType, setGoalType] = useState<'command' | 'judge'>('command')
  const [goal, setGoal] = useState('')

  const targetCount = pick ? picked.length : all.length
  const when = trigger === 'schedule' ? `Every ${INTERVALS.find((i) => i[1] === minutes)?.[0] ?? `${minutes} min`}` : trigger === 'idle' ? 'Whenever a targeted agent goes idle' : `Whenever a console prints “${pattern || '…'}”`
  const who = pick ? `${picked.length} picked console${picked.length === 1 ? '' : 's'}` : 'every console on the board'
  const rate = trigger === 'schedule' ? `≈ ${((60 / minutes) * Math.max(1, targetCount)).toFixed(1)} prompts/h across ${Math.max(1, targetCount)} console${targetCount === 1 ? '' : 's'}` : 'fires on events · 10 s cooldown per console'

  const start = async () => {
    if (!instruction.trim()) return useStore.getState().notify('Write the instruction to send')
    await api.addLoop({
      name: instruction.slice(0, 40),
      instruction: instruction.trim(),
      trigger: trigger === 'schedule' ? { type: 'schedule', everyMs: minutes * 60000 } : trigger === 'idle' ? { type: 'idle' } : { type: 'output', pattern },
      target: pick ? { ids: picked } : {},
      scope: project(useStore.getState())?.path,
      stop: {
        ...(runsOn ? { runs } : {}),
        ...(timeOn ? { timeMs: hours * 3600000 } : {}),
        ...(goalOn && goal.trim() ? { goal: goalType === 'command' ? { type: 'command' as const, command: goal.trim() } : { type: 'judge' as const, text: goal.trim() } } : {}),
      },
    })
    onDone()
  }

  return (
    <div className="loops">
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Instruction</div>
        <textarea className="field" placeholder="e.g. Continue with the next unchecked item in TODO.md" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
      </div>

      <div className="trigger-cards">
        <button className={`trigger ${trigger === 'schedule' ? 'on' : ''}`} onClick={() => setTrigger('schedule')}>
          <Clock size={19} className="ico" />
          <span>
            <div className="t">On a schedule</div>
            <div className="s">Repeats at a fixed interval.</div>
          </span>
        </button>
        <button className={`trigger ${trigger === 'idle' ? 'on' : ''}`} onClick={() => setTrigger('idle')}>
          <Moon size={19} className="ico" />
          <span>
            <div className="t">When an agent goes idle</div>
            <div className="s">Fires the moment a targeted console finishes.</div>
          </span>
        </button>
        <button className={`trigger ${trigger === 'output' ? 'on' : ''}`} onClick={() => setTrigger('output')}>
          <ScanText size={19} className="ico" />
          <span>
            <div className="t">When output contains…</div>
            <div className="s">Fires when a console prints matching text.</div>
          </span>
        </button>
      </div>

      {trigger === 'schedule' && (
        <div className="pills">
          {INTERVALS.map(([label, m]) => (
            <button key={m} className={minutes === m ? 'on' : ''} onClick={() => setMinutes(m)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {trigger === 'output' && <input className="field mono" placeholder="Text or regex, e.g. tests? failed" value={pattern} onChange={(e) => setPattern(e.target.value)} />}

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Target</div>
        <button className={`radio-row ${!pick ? 'on' : ''}`} onClick={() => setPick(false)}>
          <span className="radio" />
          <LayoutGrid size={17} color="var(--muted)" />
          <span className="t">All consoles</span>
          <span className="s">{all.length} on the board, plus any opened later</span>
        </button>
        <button className={`radio-row ${pick ? 'on' : ''}`} onClick={() => setPick(true)}>
          <span className="radio" />
          <ListChecks size={17} color="var(--muted)" />
          <span className="t">Pick consoles</span>
          <span className="s">Choose exactly which consoles receive it</span>
        </button>
        {pick && (
          <div className="pills" style={{ paddingLeft: 8 }}>
            {all.map((n) => (
              <button key={n.id} className={picked.includes(n.id) ? 'on' : ''} onClick={() => setPicked((p) => (p.includes(n.id) ? p.filter((x) => x !== n.id) : [...p, n.id]))}>
                {n.data.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Stop</div>
        <div className="list-box" style={{ padding: '10px 18px', display: 'grid', gap: 6 }}>
          <div className="toggle-row">
            <button className={`toggle ${runsOn ? 'on' : ''}`} onClick={() => setRunsOn((v) => !v)} />
            After a number of runs
            {runsOn && <input className="field" style={{ width: 90, padding: '6px 10px' }} type="number" min={1} value={runs} onChange={(e) => setRuns(Number(e.target.value) || 1)} />}
          </div>
          <div className="toggle-row">
            <button className={`toggle ${timeOn ? 'on' : ''}`} onClick={() => setTimeOn((v) => !v)} />
            After a time limit
            {timeOn && (
              <>
                <input className="field" style={{ width: 90, padding: '6px 10px' }} type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value) || 1)} /> h
              </>
            )}
          </div>
          <div className="toggle-row">
            <button className={`toggle ${goalOn ? 'on' : ''}`} onClick={() => setGoalOn((v) => !v)} />
            When a goal is met
          </div>
          {goalOn && (
            <div style={{ display: 'grid', gap: 10, paddingLeft: 66, paddingBottom: 6 }}>
              <div className="pills">
                <button className={goalType === 'command' ? 'on' : ''} onClick={() => setGoalType('command')}>
                  <SquareTerminal size={14} style={{ marginRight: 6, verticalAlign: -2 }} />A command passes
                </button>
                <button className={goalType === 'judge' ? 'on' : ''} onClick={() => setGoalType('judge')}>
                  <Crosshair size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                  An agent judges
                </button>
              </div>
              <input
                className="field mono"
                placeholder={goalType === 'command' ? 'e.g. npm test' : 'e.g. every item in TODO.md is checked'}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <div style={{ color: 'var(--faint)', fontSize: 13 }}>
                {goalType === 'command'
                  ? 'Runs in the repo folder when a targeted agent settles and before each scheduled round; exit 0 finishes the loop.'
                  : 'Claude reads the console output before each round and answers YES or NO; YES finishes the loop.'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div className="section-label">Behavior</div>
        <div className="behavior">
          {when}, the instruction is sent to {who}.<div className="rate">{rate}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" onClick={start}>
          <Repeat size={15} /> Start loop
        </button>
      </div>
    </div>
  )
}
