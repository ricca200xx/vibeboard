import { useEffect, useState } from 'react'
import { RotateCw, Settings, X } from 'lucide-react'
import { api } from '../api'
import { askNotifyPermission, useStore } from '../store'
import { AGENTS } from '../../shared/agents.js'
import { AgentIcon, Spark } from './icons'
import { fmtTokens } from './TopBar'

export function SettingsModal() {
  const settings = useStore((s) => s.settings)
  const installed = useStore((s) => s.installed)
  const s = useStore.getState()
  const close = () => s.set({ modal: null })
  const patch = (p: Partial<typeof settings>) => s.set({ settings: { ...settings, ...p } })
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow" style={{ width: 'min(620px, calc(100vw - 120px))' }}>
        <div className="modal-head">
          <span className="ico">
            <Settings size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Settings</h2>
            <div className="sub">Stored on your disk in ~/.vibeboard</div>
          </div>
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="loops">
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="section-label">Default agent</div>
            <div className="pills">
              {AGENTS.filter((a) => installed.includes(a.id)).map((a) => (
                <button key={a.id} className={settings.defaultAgent === a.id ? 'on' : ''} onClick={() => patch({ defaultAgent: a.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <AgentIcon id={a.id} size={22} /> {a.name}
                </button>
              ))}
            </div>
          </div>
          <div className="toggle-row">
            <button className={`toggle ${settings.yolo ? 'on' : ''}`} onClick={() => patch({ yolo: !settings.yolo })} />
            <span>
              New consoles skip permission prompts (YOLO)
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Claude runs with --dangerously-skip-permissions. Only on repos you trust.</div>
            </span>
          </div>
          <div className="toggle-row">
            <button
              className={`toggle ${settings.notify !== false ? 'on' : ''}`}
              onClick={() => {
                if (settings.notify === false) askNotifyPermission()
                patch({ notify: settings.notify === false })
              }}
            />
            <span>
              Notify me when an agent needs me or finishes
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Only while you are in another window. Click the notification to jump to the console.</div>
            </span>
          </div>
          <div className="toggle-row">
            <button className={`toggle ${settings.speak !== false ? 'on' : ''}`} onClick={() => patch({ speak: settings.speak === false })} />
            <span>
              Speak planner replies after a voice command
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Uses the system voice. Note: browser dictation may send audio to its vendor.</div>
            </span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="section-label">Terminal font size</div>
            <div className="pills">
              {[11, 12, 13, 14, 15, 16].map((n) => (
                <button key={n} className={settings.fontSize === n ? 'on' : ''} onClick={() => patch({ fontSize: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function UsagePanel() {
  const [u, setU] = useState<{ days: Record<string, number>; total: number } | null>(null)
  const [at, setAt] = useState(Date.now())
  const load = () =>
    api.usage().then((x) => {
      setU(x)
      setAt(Date.now())
    })
  useEffect(() => {
    load()
  }, [])
  const close = () => useStore.getState().set({ modal: null })

  // 53 weeks ending today, Monday-first rows.
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 364 - ((today.getDay() + 6) % 7))
  const cells: { day: string; n: number }[] = []
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const day = d.toISOString().slice(0, 10)
    cells.push({ day, n: u?.days[day] ?? 0 })
  }
  const peak = Math.max(1, ...cells.map((c) => c.n))
  const todayN = cells[cells.length - 1]?.n ?? 0
  let streak = 0
  for (let i = cells.length - 1; i >= 0 && cells[i].n > 0; i--) streak++
  let best = 0
  let run = 0
  for (const c of cells) {
    run = c.n > 0 ? run + 1 : 0
    best = Math.max(best, run)
  }
  const pct = Math.round((todayN / peak) * 100)
  const level = (n: number) => (n === 0 ? '#24221f' : n < peak * 0.25 ? '#5a2a1f' : n < peak * 0.5 ? '#94391f' : n < peak * 0.75 ? '#cc4a28' : '#f0553a')
  const R = 36
  const C = 2 * Math.PI * R

  return (
    <div className="backdrop" style={{ background: 'transparent', placeItems: 'start end' }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="menu usage">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 12px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontWeight: 600, fontSize: 17 }}>usage</span>
          <Spark size={16} />
          <span className="spacer" />
          <button className="icon-btn sm" title="Refresh" onClick={load}>
            <RotateCw size={13} />
          </button>
          <button className="icon-btn sm" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', padding: 16 }}>
          <svg className="ring" viewBox="0 0 86 86">
            <circle cx="43" cy="43" r={R} fill="none" stroke="#2a2724" strokeWidth="6" />
            <circle cx="43" cy="43" r={R} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 43 43)" />
            <text x="43" y="44" textAnchor="middle" fill="var(--text)" fontSize="17" fontWeight="600">
              {pct}%
            </text>
            <text x="43" y="58" textAnchor="middle" fill="var(--muted)" fontSize="9">
              of peak
            </text>
          </svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>Today · {fmtTokens(todayN)} tokens</div>
            <div className="mono" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
              from your local Claude Code session logs
            </div>
          </div>
        </div>
        <div style={{ padding: '4px 16px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="section-label">Activity</span>
            <span style={{ color: 'var(--faint)', fontSize: 12 }}>Last 12 months</span>
          </div>
          <div className="heat">
            {cells.map((c) => (
              <i key={c.day} title={`${c.day}: ${fmtTokens(c.n)}`} style={{ background: level(c.n) }} />
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 28px', padding: '8px 16px 16px', fontSize: 13.5 }}>
          <Stat k="Lifetime" v={fmtTokens(u?.total ?? 0)} />
          <Stat k="Peak" v={fmtTokens(peak === 1 ? 0 : peak)} />
          <Stat k="Streak" v={`${streak}d (best ${best}d)`} />
          <Stat k="Active days" v={String(cells.filter((c) => c.n > 0).length)} />
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid var(--line)', padding: '10px 16px', color: 'var(--faint)', fontSize: 12 }}>
          <span className="mono">claude › ~/.claude/projects</span>
          <span className="spacer" />
          updated {Math.round((Date.now() - at) / 1000) < 5 ? 'just now' : 'a moment ago'}
        </div>
      </div>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  )
}
