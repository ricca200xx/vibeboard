import { useEffect, useState } from 'react'
import { ArrowLeft, Briefcase, ChevronDown, Folder, FolderOpen, Info, Plus, Settings, X } from 'lucide-react'
import { api } from '../api'
import { consoles, project, useStore } from '../store'
import { Spark } from './icons'

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

export function TopBar() {
  const p = useStore(project)!
  const projects = useStore((s) => s.projects)
  const live = useStore((s) => Object.keys(s.live).length)
  const s = useStore.getState()
  const [projMenu, setProjMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [today, setToday] = useState<number | null>(null)

  useEffect(() => {
    const load = () =>
      api
        .usage()
        .then((u) => setToday(u.days[new Date().toISOString().slice(0, 10)] ?? 0))
        .catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="topbar">
      <button className="pill" onClick={s.goHome}>
        <ArrowLeft size={16} /> Back to home
      </button>

      <div className="pill tabs" style={{ position: 'relative' }}>
        <button className="project" onClick={() => setProjMenu((v) => !v)}>
          <Folder size={15} fill="currentColor" strokeWidth={1.5} /> {p.name} <ChevronDown size={14} color="var(--muted)" />
        </button>
        {p.workspaces.map((w) => (
          <button
            key={w.id}
            className={`tab ${w.id === p.activeWs ? 'active' : ''}`}
            onClick={() => s.switchWorkspace(w.id)}
            onDoubleClick={() => setRenaming(w.id)}
          >
            {renaming === w.id ? (
              <input
                autoFocus
                defaultValue={w.name}
                onBlur={(e) => {
                  s.renameWorkspace(w.id, e.target.value.trim() || w.name)
                  setRenaming(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              w.name
            )}
            <span className="count">{consoles(w.nodes).length}</span>
            <span
              className="x"
              onClick={(e) => {
                e.stopPropagation()
                s.closeWorkspace(w.id)
              }}
            >
              <X size={13} />
            </span>
          </button>
        ))}
        <button className="icon-btn" title="New workspace" onClick={s.addWorkspace}>
          <Plus size={16} />
        </button>

        {projMenu && (
          <div className="menu" style={{ top: 46, left: 0, width: 300 }} onMouseLeave={() => setProjMenu(false)}>
            <div className="menu-title">Projects</div>
            {projects.map((x) => (
              <button
                key={x.path}
                className="menu-item"
                onClick={() => {
                  setProjMenu(false)
                  s.openProject(x.path)
                }}
              >
                <Folder size={16} color="var(--muted)" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="title" style={{ fontSize: 14 }}>
                    {x.name}
                  </div>
                  <div className="sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {x.path}
                  </div>
                </span>
              </button>
            ))}
            <button className="menu-item" onClick={s.goHome}>
              <FolderOpen size={16} color="var(--accent)" />
              <span className="title" style={{ fontSize: 14 }}>
                Open another folder…
              </span>
            </button>
          </div>
        )}
      </div>

      <button className="pill" onClick={s.closeProject}>
        <X size={15} /> Close
      </button>

      <span className="spacer" />

      <span className="pill" title="Running consoles">
        <span className="dot" style={{ background: 'var(--live)', width: 7, height: 7 }} /> {live} <span className="muted">live</span>
      </span>
      <button className="pill" title="Usage" onClick={() => s.set({ modal: 'usage' })}>
        <Info size={15} color="var(--muted)" />
        <Spark size={14} />
        <span className="muted">today</span> {today === null ? '–' : fmtTokens(today)}
      </button>
      <button className="icon-btn" title="Presets" onClick={() => s.set({ modal: useStore.getState().modal === 'presets' ? null : 'presets' })}>
        <Briefcase size={17} />
      </button>
      <button className="icon-btn" title="Settings" onClick={() => s.set({ modal: 'settings' })}>
        <Settings size={17} />
      </button>
      <span className="avatar" />
    </div>
  )
}
