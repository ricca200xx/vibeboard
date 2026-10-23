import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, Crosshair, Network, Search, Send, Users, X } from 'lucide-react'
import type { Node } from '@xyflow/react'
import { consoles, useStore, workspace, type ConsoleData, type GroupData } from '../store'
import { agentById } from '../../shared/agents.js'
import { AgentGlyph } from './icons'

type Filter = 'all' | 'working' | 'needs' | 'idle' | 'done'
type Team = { id: string; label: string; color: string; members: Node<ConsoleData>[] }

const STATUS_TEXT: Record<string, string> = { idle: 'At the prompt', working: 'Working', needs: 'Needs you', done: 'Done', stopped: 'Stopped', paused: 'Paused' }
const STATUS_COLOR: Record<string, string> = { idle: 'var(--idle)', working: 'var(--working)', needs: 'var(--needs)', done: 'var(--done)', stopped: 'var(--faint)', paused: '#9db4ff' }

const ROW = 57
const CARD_H = 44

export function MissionMap() {
  const ws = useStore(workspace)!
  const live = useStore((s) => s.live)
  const close = () => useStore.getState().set({ modal: null })
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<{ kind: 'team' | 'console'; id: string } | null>(null)
  const [prompt, setPrompt] = useState('')
  const graphRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  useLayoutEffect(() => {
    const el = graphRef.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const all = consoles(ws.nodes)
  const statusOf = (id: string) => (live[id] ? (live[id].paused ? 'paused' : live[id].status) : 'stopped')
  const groups = ws.nodes.filter((n) => n.type === 'group') as Node<GroupData>[]
  const teams: Team[] = groups.map((g) => ({ id: g.id, label: g.data.label, color: g.data.color, members: all.filter((n) => n.parentId === g.id) }))
  const loose = all.filter((n) => !n.parentId || !groups.some((g) => g.id === n.parentId))
  if (loose.length) teams.push({ id: '__loose', label: 'Ungrouped', color: '#8a847c', members: loose })

  const counts = {
    all: all.length,
    working: all.filter((n) => statusOf(n.id) === 'working').length,
    needs: all.filter((n) => statusOf(n.id) === 'needs').length,
    idle: all.filter((n) => ['idle', 'stopped', 'paused'].includes(statusOf(n.id))).length,
    done: all.filter((n) => statusOf(n.id) === 'done').length,
  }
  const matches = (n: Node<ConsoleData>) => {
    const st = statusOf(n.id)
    const okFilter = filter === 'all' || (filter === 'idle' ? ['idle', 'stopped', 'paused'].includes(st) : st === filter)
    return okFilter && (!q || n.data.name.toLowerCase().includes(q.toLowerCase()))
  }

  // Layout: orchestrator → teams → consoles, one console per row.
  const ordered = teams.flatMap((t) => t.members.map((m) => ({ m, t })))
  const cardW = 200
  const teamW = 170
  const orchW = 180
  const xConsole = Math.max(teamW + orchW + 160, width - cardW - 4)
  const xTeam = Math.round((orchW + xConsole - teamW) / 2 + 20)
  const yOf = (i: number) => 8 + i * ROW
  let idx = 0
  const teamY = teams.map((t) => {
    const ys = t.members.map(() => yOf(idx++))
    return ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : yOf(idx)
  })
  const orchY = teamY.length ? (teamY[0] + teamY[teamY.length - 1]) / 2 : 8
  const height = Math.max(460, yOf(ordered.length) + 10)
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2
    return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }

  const jump = (ids: string[]) => {
    close()
    setTimeout(() => useStore.getState().frame(ids), 30)
  }

  const selectedTeam = sel?.kind === 'team' ? teams.find((t) => t.id === sel.id) : !sel ? teams[0] : undefined
  const selectedConsole = sel?.kind === 'console' ? all.find((n) => n.id === sel.id) : undefined
  const working = counts.working

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <span className="ico">
            <Network size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Mission Map</h2>
            <div className="sub">
              1 orchestrator · {groups.length} team{groups.length === 1 ? '' : 's'} · {all.length} consoles · {working} working
            </div>
          </div>
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="mm">
          <div className="mm-main">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="seg">
                {(
                  [
                    ['all', 'All', null],
                    ['working', 'Working', 'var(--working)'],
                    ['needs', 'Needs you', 'var(--needs)'],
                    ['idle', 'Idle', 'var(--idle)'],
                    ['done', 'Done', 'var(--done)'],
                  ] as const
                ).map(([k, label, color]) => (
                  <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                    {color && <span className="dot" style={{ background: filter === k ? '#fff' : color, width: 6, height: 6 }} />}
                    {label} <span className="n">{counts[k]}</span>
                  </button>
                ))}
              </div>
              <span className="spacer" />
              <div className="search">
                <Search size={14} />
                <input placeholder="Find a console or team" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>

            <div className="nowheel" style={{ overflow: 'auto', flex: 1, maxHeight: 'calc(100vh - 380px)' }}>
              <div className="mm-graph" ref={graphRef} style={{ height }}>
                <svg>
                  {teams.map((t, ti) => (
                    <path key={t.id} d={curve(orchW, orchY + CARD_H / 2, xTeam, teamY[ti] + CARD_H / 2)} stroke="#6b8f5e" strokeWidth={1.3} fill="none" opacity={0.8} />
                  ))}
                  {(() => {
                    let i = 0
                    return teams.flatMap((t, ti) =>
                      t.members.map((m) => {
                        const y = yOf(i++)
                        return (
                          <path
                            key={m.id}
                            d={curve(xTeam + teamW, teamY[ti] + CARD_H / 2, xConsole, y + CARD_H / 2)}
                            stroke={t.id === '__loose' ? '#5f5a54' : '#6b8f5e'}
                            strokeDasharray={t.id === '__loose' ? '4 4' : undefined}
                            strokeWidth={1.3}
                            fill="none"
                            opacity={matches(m) ? 0.85 : 0.2}
                          />
                        )
                      }),
                    )
                  })()}
                </svg>

                <button className="mm-card" style={{ left: 0, top: orchY, width: orchW }} onClick={() => setSel(null)}>
                  <span className="agent-icon" style={{ width: 26, height: 26, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    <Network size={14} />
                  </span>
                  <span>
                    <div className="t">Orchestrator</div>
                    <div className="s">
                      {all.length} agents · Command bar
                    </div>
                  </span>
                </button>

                {teams.map((t, ti) => {
                  const busy = t.members.filter((m) => statusOf(m.id) === 'working').length
                  return (
                    <button
                      key={t.id}
                      className={`mm-card ${selectedTeam?.id === t.id ? 'sel' : ''}`}
                      style={{ left: xTeam, top: teamY[ti], width: teamW }}
                      onClick={() => setSel({ kind: 'team', id: t.id })}
                      onDoubleClick={() => jump(t.id === '__loose' ? t.members.map((m) => m.id) : [t.id])}
                    >
                      <span className="dot" style={{ background: t.color }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="t">{t.label}</div>
                        <div className="s">{busy ? `${busy} working` : `${t.members.length} idle`}</div>
                      </span>
                      <span className="s">{t.members.length}</span>
                    </button>
                  )
                })}

                {ordered.map(({ m }, i) => {
                  const st = statusOf(m.id)
                  return (
                    <button
                      key={m.id}
                      className={`mm-card ${matches(m) ? '' : 'faded'} ${selectedConsole?.id === m.id ? 'sel' : ''}`}
                      style={{ left: xConsole, top: yOf(i), width: cardW }}
                      onClick={() => setSel({ kind: 'console', id: m.id })}
                      onDoubleClick={() => jump([m.id])}
                    >
                      <AgentGlyph id={m.data.agent} size={15} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="t">{m.data.name}</div>
                        <div className="s">{STATUS_TEXT[st]}</div>
                      </span>
                      <span className="dot" style={{ background: STATUS_COLOR[st], width: 6, height: 6 }} />
                    </button>
                  )
                })}
                {!all.length && <div className="menu-hint" style={{ position: 'absolute', left: xTeam, top: 20 }}>No consoles on this workspace yet</div>}
              </div>
            </div>

            <div className="mm-legend">
              {(['working', 'needs', 'idle', 'done'] as const).map((k) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="dot" style={{ background: STATUS_COLOR[k], width: 6, height: 6 }} /> {k === 'needs' ? 'Needs you' : k[0].toUpperCase() + k.slice(1)}
                </span>
              ))}
              <span>- - - Command bar only</span>
              <span className="spacer" />
              <span style={{ color: 'var(--faint)' }}>Click to inspect · Double-click to jump there</span>
            </div>
          </div>

          <div className="mm-side">
            {selectedConsole ? (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="agent-icon" style={{ width: 44, height: 44, background: 'var(--panel-3)' }}>
                    <AgentGlyph id={selectedConsole.data.agent} size={22} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 18 }}>{selectedConsole.data.name}</div>
                    <div style={{ color: 'var(--muted)' }}>
                      {agentById(selectedConsole.data.agent)?.name} · {STATUS_TEXT[statusOf(selectedConsole.id)]}
                    </div>
                  </div>
                </div>
                <div className="mono" style={{ color: 'var(--muted)', fontSize: 12, wordBreak: 'break-all' }}>
                  {selectedConsole.data.cwd}
                </div>
                <button className="btn primary" style={{ justifyContent: 'center', height: 40 }} onClick={() => jump([selectedConsole.id])}>
                  <Crosshair size={15} /> Jump there
                </button>
                <div className="section-label">Send a prompt</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="field"
                    placeholder={`Tell ${selectedConsole.data.name}…`}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && prompt.trim()) {
                        useStore.getState().sendTo([selectedConsole.id], prompt.trim())
                        setPrompt('')
                      }
                    }}
                  />
                  <button
                    className="btn"
                    onClick={() => {
                      if (!prompt.trim()) return
                      useStore.getState().sendTo([selectedConsole.id], prompt.trim())
                      setPrompt('')
                    }}
                  >
                    <Send size={14} />
                  </button>
                </div>
              </>
            ) : selectedTeam ? (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="agent-icon" style={{ width: 44, height: 44, background: 'rgba(62,207,142,.1)', color: '#7fcf9a' }}>
                    <Users size={21} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 18 }}>{selectedTeam.label}</div>
                    <div style={{ color: 'var(--muted)' }}>{selectedTeam.members.length} consoles</div>
                  </div>
                </div>
                <button
                  className="btn primary"
                  style={{ justifyContent: 'center', height: 40 }}
                  onClick={() => jump(selectedTeam.id === '__loose' ? selectedTeam.members.map((m) => m.id) : [selectedTeam.id])}
                >
                  <Crosshair size={15} /> Frame the team on the board
                </button>
                <div className="section-label">Members</div>
                <div className="list-box">
                  {selectedTeam.members.map((m) => (
                    <button key={m.id} className="member" onClick={() => setSel({ kind: 'console', id: m.id })}>
                      <AgentGlyph id={m.data.agent} size={16} />
                      <span style={{ flex: 1 }}>
                        <div className="t">{m.data.name}</div>
                        <div className="s">{STATUS_TEXT[statusOf(m.id)]}</div>
                      </span>
                      <span className="dot" style={{ background: STATUS_COLOR[statusOf(m.id)], width: 6, height: 6 }} />
                    </button>
                  ))}
                </div>
                <div className="section-label">Commanded by</div>
                <div className="list-box">
                  <button className="member" onClick={() => setSel(null)}>
                    <Network size={15} color="var(--accent)" />
                    <span style={{ flex: 1 }}>
                      <div className="t">Orchestrator</div>
                      <div className="s">{all.length} agents · Command bar</div>
                    </span>
                    <ChevronRight size={15} color="var(--faint)" />
                  </button>
                </div>
              </>
            ) : (
              <div className="menu-hint">Spawn consoles to see them here.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
