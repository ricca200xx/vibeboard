import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChevronRight, CircleX, Command, Crosshair, Network, Pause, Play, Search, Users, X } from 'lucide-react'
import type { Node } from '@xyflow/react'
import { api } from '../api'
import { consoles, useStore, workspace, type ConsoleData, type GroupData } from '../store'
import { agentById } from '../../shared/agents.js'
import { AgentGlyph } from './icons'
import { useNow } from './LoopsModal'

type Filter = 'all' | 'working' | 'needs' | 'idle' | 'done'
type Team = { id: string; label: string; color: string; members: Node<ConsoleData>[] }
type Sel = { kind: 'console' | 'team'; id: string } | { kind: 'orch' | 'center' } | null

const STATUS_TEXT: Record<string, string> = { idle: 'At the prompt', working: 'Working', needs: 'Needs you', done: 'Done', stopped: 'Stopped', paused: 'Paused' }
const STATUS_COLOR: Record<string, string> = { idle: 'var(--idle)', working: 'var(--working)', needs: 'var(--needs)', done: 'var(--done)', stopped: 'var(--faint)', paused: '#9db4ff' }

const ROW = 57
const CARD_H = 44
const GAP = 24 // between the teams and the consoles outside any team
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function MissionMap() {
  const ws = useStore(workspace)!
  const live = useStore((s) => s.live)
  const activeLoops = useStore((s) => s.loops.filter((l) => l.active && (!l.scope || l.scope === s.active)).length)
  const close = () => useStore.getState().set({ modal: null })
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Sel>(null)
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
  const inTeams = all.length - loose.length
  const orchestrators = teams.length ? 1 : 0

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

  // Layout: orchestrator → teams → their consoles, then the command center → consoles in no team.
  const cardW = 200
  const teamW = 170
  const orchW = 180
  const xConsole = Math.max(teamW + orchW + 160, width - cardW - 4)
  const xTeam = Math.round((orchW + xConsole - teamW) / 2 + 20)
  let row = 0
  const teamRows = teams.map((t) => t.members.map(() => 8 + row++ * ROW))
  const teamY = teamRows.map((ys) => (ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : 8 + row++ * ROW))
  const orchY = teamY.length ? (teamY[0] + teamY[teamY.length - 1]) / 2 : 8
  const looseTop = 8 + row * ROW + (teams.length ? GAP : 0)
  const looseY = loose.map((_, i) => looseTop + i * ROW)
  const height = Math.max(460, (loose.length ? looseY[looseY.length - 1] : 8 + row * ROW) + CARD_H + 12)
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2
    return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }

  const jump = (ids: string[]) => {
    close()
    setTimeout(() => useStore.getState().frame(ids), 30)
  }
  const isSel = (kind: string, id?: string) => sel?.kind === kind && (!id || ('id' in sel && sel.id === id))
  const consoleCard = (m: Node<ConsoleData>, top: number) => {
    const st = statusOf(m.id)
    return (
      <button
        key={m.id}
        className={`mm-card ${matches(m) ? '' : 'faded'} ${isSel('console', m.id) ? 'sel' : ''}`}
        style={{ left: xConsole, top, width: cardW }}
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
  }

  const team = sel?.kind === 'team' ? teams.find((t) => t.id === sel.id) : undefined
  const picked = sel?.kind === 'console' ? all.find((n) => n.id === sel.id) : undefined
  const workingIn = (list: Node<ConsoleData>[]) => list.filter((m) => statusOf(m.id) === 'working').length

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
              {plural(orchestrators, 'orchestrator')} · {plural(teams.length, 'team')} · {plural(all.length, 'console')} · {counts.working} working
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
              <div className="mm-graph" ref={graphRef} style={{ height }} onClick={(e) => e.target === e.currentTarget && setSel(null)}>
                <svg>
                  {teams.map((t, ti) => (
                    <path key={t.id} d={curve(orchW, orchY + CARD_H / 2, xTeam, teamY[ti] + CARD_H / 2)} stroke="#6b8f5e" strokeWidth={1.3} fill="none" opacity={0.8} />
                  ))}
                  {teams.flatMap((t, ti) =>
                    t.members.map((m, mi) => (
                      <path
                        key={m.id}
                        d={curve(xTeam + teamW, teamY[ti] + CARD_H / 2, xConsole, teamRows[ti][mi] + CARD_H / 2)}
                        stroke="#6b8f5e"
                        strokeWidth={1.3}
                        fill="none"
                        opacity={matches(m) ? 0.85 : 0.2}
                      />
                    )),
                  )}
                  {loose.map((m, i) => (
                    <path
                      key={m.id}
                      d={curve(orchW, looseTop + CARD_H / 2, xConsole, looseY[i] + CARD_H / 2)}
                      stroke="#8a847c"
                      strokeDasharray="4 4"
                      strokeWidth={1.2}
                      fill="none"
                      opacity={matches(m) ? 0.7 : 0.15}
                    />
                  ))}
                </svg>

                {teams.length > 0 && (
                  <button className={`mm-card ${isSel('orch') ? 'sel' : ''}`} style={{ left: 0, top: orchY, width: orchW }} onClick={() => setSel({ kind: 'orch' })} onDoubleClick={() => jump(teams.map((t) => t.id))}>
                    <span className="agent-icon" style={{ width: 26, height: 26, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      <Network size={14} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div className="t">Orchestrator</div>
                      <div className="s">
                        {plural(inTeams, 'agent')} · {teams.length === 1 ? 'Team' : plural(teams.length, 'team')}
                      </div>
                    </span>
                    <span className="s ring-n">
                      <Ring part={workingIn(all.filter((n) => !loose.includes(n)))} of={inTeams} />
                      {workingIn(all.filter((n) => !loose.includes(n)))}/{inTeams}
                    </span>
                  </button>
                )}

                {teams.map((t, ti) => {
                  const busy = workingIn(t.members)
                  return (
                    <button
                      key={t.id}
                      className={`mm-card team ${isSel('team', t.id) ? 'sel' : ''}`}
                      style={{ left: xTeam, top: teamY[ti], width: teamW }}
                      onClick={() => setSel({ kind: 'team', id: t.id })}
                      onDoubleClick={() => jump([t.id])}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="t">
                          <span className="dot" style={{ background: t.color, width: 6, height: 6 }} /> {t.label}
                        </div>
                        <div className="s">{busy ? `${busy} working` : `${t.members.length} idle`}</div>
                        <div className="bar">
                          <i style={{ width: `${t.members.length ? (busy / t.members.length) * 100 : 0}%` }} />
                        </div>
                      </span>
                      <span className="s">{t.members.length}</span>
                      <Users size={12} color="var(--faint)" />
                    </button>
                  )
                })}

                {loose.length > 0 && (
                  <button className={`mm-card ${isSel('center') ? 'sel' : ''}`} style={{ left: 0, top: looseTop, width: orchW }} onClick={() => setSel({ kind: 'center' })} onDoubleClick={() => jump(loose.map((m) => m.id))}>
                    <Command size={14} color="var(--muted)" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div className="t">Command center</div>
                      <div className="s ellipsis">{loose.length} only reachable from the command bar</div>
                    </span>
                  </button>
                )}

                {teams.flatMap((t, ti) => t.members.map((m, mi) => consoleCard(m, teamRows[ti][mi])))}
                {loose.map((m, i) => consoleCard(m, looseY[i]))}
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
            {picked ? (
              <ConsoleDetail
                node={picked}
                status={statusOf(picked.id)}
                team={teams.find((t) => t.id === picked.parentId)}
                onTeam={(id) => setSel({ kind: 'team', id })}
                onOrch={() => setSel({ kind: 'orch' })}
                onCenter={() => setSel({ kind: 'center' })}
                onJump={() => jump([picked.id])}
              />
            ) : team ? (
              <>
                <SideHead icon={<Users size={21} />} title={team.label} sub={plural(team.members.length, 'console')} tint="green" />
                <button className="btn primary wide" onClick={() => jump([team.id])}>
                  <Crosshair size={15} /> Frame the team on the board
                </button>
                <div className="section-label">Members</div>
                <MemberList members={team.members} statusOf={statusOf} onPick={(id) => setSel({ kind: 'console', id })} />
                <div className="section-label">Commanded by</div>
                <div className="list-box">
                  <button className="member" onClick={() => setSel({ kind: 'orch' })}>
                    <Network size={15} color="var(--accent)" />
                    <span style={{ flex: 1 }}>
                      <div className="t">Orchestrator</div>
                      <div className="s">
                        {plural(inTeams, 'agent')} · {teams.length === 1 ? 'Team' : plural(teams.length, 'team')}
                      </div>
                    </span>
                    <ChevronRight size={15} color="var(--faint)" />
                  </button>
                </div>
              </>
            ) : sel?.kind === 'orch' ? (
              <>
                <SideHead icon={<Network size={21} />} title="Orchestrator" sub={`${plural(inTeams, 'agent')} · ${plural(teams.length, 'team')}`} tint="accent" />
                <button className="btn primary wide" onClick={() => jump(teams.map((t) => t.id))}>
                  <Crosshair size={15} /> Frame its teams on the board
                </button>
                <div className="section-label">Teams</div>
                <div className="list-box">
                  {teams.map((t) => (
                    <button key={t.id} className="member" onClick={() => setSel({ kind: 'team', id: t.id })}>
                      <span className="dot" style={{ background: t.color, width: 7, height: 7 }} />
                      <span style={{ flex: 1 }}>
                        <div className="t">{t.label}</div>
                        <div className="s">
                          {plural(t.members.length, 'console')} · {workingIn(t.members)} working
                        </div>
                      </span>
                      <ChevronRight size={15} color="var(--faint)" />
                    </button>
                  ))}
                </div>
                <div className="mm-hint">Reach a whole team from the command bar with @ and its name.</div>
              </>
            ) : sel?.kind === 'center' ? (
              <>
                <SideHead icon={<Command size={20} />} title="Command center" sub={plural(loose.length, 'console')} />
                <button className="btn primary wide" onClick={() => jump(loose.map((m) => m.id))}>
                  <Crosshair size={15} /> Frame them on the board
                </button>
                <div className="section-label">Consoles</div>
                <MemberList members={loose} statusOf={statusOf} onPick={(id) => setSel({ kind: 'console', id })} />
                <div className="mm-hint">Not in any team: the command bar reaches them one by one. Group them to give them an orchestrator.</div>
              </>
            ) : (
              <>
                <div className="section-label plain">Fleet</div>
                <div className="list-box stats">
                  {(['working', 'needs', 'idle', 'done'] as const).map((k) => (
                    <div key={k} className={counts[k] ? '' : 'zero'}>
                      <span className="dot" style={{ background: STATUS_COLOR[k], width: 6, height: 6 }} />
                      {k === 'needs' ? 'Needs you' : k[0].toUpperCase() + k.slice(1)}
                      <b>{counts[k]}</b>
                    </div>
                  ))}
                </div>
                <div className="section-label plain">Structure</div>
                <div className="list-box stats">
                  {(
                    [
                      ['Orchestrators', orchestrators],
                      ['Teams', teams.length],
                      ['Consoles', all.length],
                      ['Active loops', activeLoops],
                    ] as const
                  ).map(([label, n]) => (
                    <div key={label} className={n ? '' : 'zero'}>
                      {label}
                      <b>{n}</b>
                    </div>
                  ))}
                </div>
                <div className="mm-hint">Select a console, a team or a commander to see what it is doing and act on it.</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Ring({ part, of }: { part: number; of: number }) {
  const c = 2 * Math.PI * 5
  return (
    <svg width="13" height="13" viewBox="0 0 13 13">
      <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--line-2)" strokeWidth="1.6" />
      {part > 0 && <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--working)" strokeWidth="1.6" strokeDasharray={`${(part / of) * c} ${c}`} transform="rotate(-90 6.5 6.5)" />}
    </svg>
  )
}

function SideHead({ icon, title, sub, tint }: { icon: React.ReactNode; title: string; sub: string; tint?: 'green' | 'accent' }) {
  const colors = tint === 'green' ? ['rgba(62,207,142,.1)', '#7fcf9a'] : tint === 'accent' ? ['var(--accent-soft)', 'var(--accent)'] : ['var(--panel-3)', 'var(--text-2)']
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span className="agent-icon" style={{ width: 44, height: 44, background: colors[0], color: colors[1] }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>{title}</div>
        <div style={{ color: 'var(--muted)' }}>{sub}</div>
      </div>
    </div>
  )
}

function MemberList({ members, statusOf, onPick }: { members: Node<ConsoleData>[]; statusOf: (id: string) => string; onPick: (id: string) => void }) {
  return (
    <div className="list-box">
      {members.map((m) => (
        <button key={m.id} className="member" onClick={() => onPick(m.id)}>
          <AgentGlyph id={m.data.agent} size={16} />
          <span style={{ flex: 1 }}>
            <div className="t">{m.data.name}</div>
            <div className="s">{STATUS_TEXT[statusOf(m.id)]}</div>
          </span>
          <span className="dot" style={{ background: STATUS_COLOR[statusOf(m.id)], width: 6, height: 6 }} />
        </button>
      ))}
    </div>
  )
}

const since = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

function ConsoleDetail(props: {
  node: Node<ConsoleData>
  status: string
  team?: Team
  onTeam: (id: string) => void
  onOrch: () => void
  onCenter: () => void
  onJump: () => void
}) {
  const { node, status, team } = props
  const session = useStore((s) => s.live[node.id])
  const now = useNow()
  return (
    <>
      <SideHead icon={<AgentGlyph id={node.data.agent} size={22} />} title={node.data.name} sub={agentById(node.data.agent)?.name ?? node.data.agent} />
      <button className="btn primary wide" onClick={props.onJump}>
        <ArrowUpRight size={15} /> Go to the console
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button className="btn wide" disabled={!session} onClick={() => api.signal(node.id, session?.paused ? 'SIGCONT' : 'SIGSTOP')}>
          {session?.paused ? <Play size={14} /> : <Pause size={14} />} {session?.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn wide danger" disabled={!session} onClick={() => api.kill(node.id)}>
          <CircleX size={14} /> Kill
        </button>
      </div>
      <div className="section-label plain">Now</div>
      <div className="list-box stats">
        <div>
          <span className="dot" style={{ background: STATUS_COLOR[status], width: 6, height: 6 }} />
          Status
          <b style={{ color: status === 'working' ? 'var(--working)' : undefined, fontFamily: 'inherit' }}>{STATUS_TEXT[status]}</b>
        </div>
        <div>
          For
          <b>{session?.statusAt ? since(now - session.statusAt) : '—'}</b>
        </div>
      </div>
      <div className="section-label plain">Belongs to</div>
      <div className="list-box">
        {team ? (
          <>
            <button className="member" onClick={() => props.onTeam(team.id)}>
              <span className="dot" style={{ background: team.color, width: 7, height: 7 }} />
              <span style={{ flex: 1 }}>
                <div className="t">{team.label}</div>
                <div className="s">{plural(team.members.length, 'console')}</div>
              </span>
              <ChevronRight size={15} color="var(--faint)" />
            </button>
            <button className="member" onClick={props.onOrch}>
              <Network size={15} color="var(--accent)" />
              <span style={{ flex: 1 }}>
                <div className="t">Orchestrator</div>
                <div className="s">Through the team</div>
              </span>
              <ChevronRight size={15} color="var(--faint)" />
            </button>
          </>
        ) : (
          <button className="member" onClick={props.onCenter}>
            <Command size={15} color="var(--muted)" />
            <span style={{ flex: 1 }}>
              <div className="t">Command center</div>
              <div className="s">Not wired to any orchestrator</div>
            </span>
            <ChevronRight size={15} color="var(--faint)" />
          </button>
        )}
      </div>
    </>
  )
}
