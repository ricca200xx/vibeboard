import { useState } from 'react'
import { Brain, Check, Pencil, Plus, ScanSearch, Send, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { consoles, project, useStore, workspace, type Memory } from '../store'

const KINDS = ['Structure', 'Commands', 'Conventions', 'Gotchas']

// Memories never reach a console on their own: they are typed in only when pushed.
const asPrompt = (list: Memory[]) => `Project memory, keep this in mind:\n${list.map((m) => `- [${m.kind}] ${m.title}: ${m.text}`).join('\n')}`

export function MemoryModal() {
  const p = useStore(project)!
  const projects = useStore((s) => s.projects)
  const [tab, setTab] = useState<'repo' | 'all'>('repo')
  const [editing, setEditing] = useState<Memory | 'new' | null>(null)
  const [scanning, setScanning] = useState(false)
  const s = useStore.getState()
  const close = () => s.set({ modal: null })
  const list = tab === 'repo' ? p.memories : projects.flatMap((x) => x.memories)
  const active = p.memories.filter((m) => m.enabled)

  const targets = () => {
    const nodes = consoles(workspace(useStore.getState())!.nodes)
    const sel = nodes.filter((n) => n.selected)
    return (sel.length ? sel : nodes).map((n) => n.id)
  }
  const push = (items: Memory[]) => {
    const ids = targets()
    if (!items.length || !ids.length) return s.notify('Nothing to push')
    const sent = s.sendTo(ids, asPrompt(items))
    if (!sent) return s.notify('None of those consoles is running')
    s.notify(`Pushed ${items.length} memor${items.length > 1 ? 'ies' : 'y'} to ${sent} console${sent > 1 ? 's' : ''}`)
  }
  const scan = async () => {
    setScanning(true)
    try {
      const found = await api.scan(p.path)
      found.forEach((m) => s.addMemory({ kind: KINDS.includes(m.kind) ? m.kind : 'Structure', title: m.title, text: m.text, enabled: true }))
      s.notify(`Scan added ${found.length} memories`)
    } catch (e) {
      s.notify(`Scan failed: ${(e as Error).message}`)
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow" style={{ width: 'min(1000px, calc(100vw - 120px))' }}>
        <div className="modal-head">
          <span className="ico">
            <Brain size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Memory</h2>
            <div className="sub">What your agents should know — pushed from a memory card when you say so.</div>
          </div>
          <button className="btn ghost" onClick={scan} disabled={scanning}>
            <ScanSearch size={15} /> {scanning ? 'Scanning…' : 'Scan repo'}
          </button>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> New memory
          </button>
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '14px 16px 6px' }}>
          <div className="seg">
            <button className={tab === 'repo' ? 'on' : ''} onClick={() => setTab('repo')}>
              {p.name} <span className="n">{p.memories.length}</span>
            </button>
            <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
              All repos <span className="n">{projects.reduce((n, x) => n + x.memories.length, 0)}</span>
            </button>
          </div>
        </div>
        <div className="modal-body nowheel">
          <div className="memory-list">
            {editing && <MemoryEditor initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
            {list.map((m) => (
              <div className="memory" key={m.id}>
                <div className="head">
                  <span className="dot" style={{ background: 'var(--done)', width: 6, height: 6 }} />
                  <span className="kind">{m.kind}</span>
                  <span className="t">{m.title}</span>
                </div>
                <div className="body">{m.text}</div>
                {tab === 'repo' && (
                  <div className="acts">
                    <button className="icon-btn sm" title="Push to consoles" onClick={() => push([m])}>
                      <Send size={13} />
                    </button>
                    <button className="icon-btn sm" title="Edit" onClick={() => setEditing(m)}>
                      <Pencil size={13} />
                    </button>
                    <button className="icon-btn sm" title="Delete" onClick={() => s.removeMemory(m.id)}>
                      <Trash2 size={13} />
                    </button>
                    <button className={`check ${m.enabled ? 'on' : ''}`} title="Include when pushing all" onClick={() => s.updateMemory(m.id, { enabled: !m.enabled })}>
                      <Check size={13} strokeWidth={3} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!list.length && !editing && <div className="menu-hint">No memories yet. Scan the repo or write one.</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: '1px solid var(--line)', color: 'var(--muted)', fontSize: 13 }}>
          {active.length} active entr{active.length === 1 ? 'y' : 'ies'} — consoles launch clean. Push to deliver.
          <span className="spacer" />
          <button className="btn" onClick={() => push(active)} disabled={!active.length}>
            <Send size={14} /> Push to {consoles(workspace(useStore.getState())!.nodes).some((n) => n.selected) ? 'selected' : 'all'} consoles
          </button>
        </div>
      </div>
    </div>
  )
}

function MemoryEditor({ initial, onDone }: { initial: Memory | null; onDone: () => void }) {
  const [kind, setKind] = useState(initial?.kind ?? 'Structure')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const save = () => {
    if (!title.trim() || !text.trim()) return
    const s = useStore.getState()
    if (initial) s.updateMemory(initial.id, { kind, title: title.trim(), text: text.trim() })
    else s.addMemory({ kind, title: title.trim(), text: text.trim(), enabled: true })
    onDone()
  }
  return (
    <div className="memory" style={{ gridTemplateColumns: '1fr', gap: 10, borderColor: 'var(--accent)' }}>
      <div className="pills">
        {KINDS.map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} style={{ height: 30, fontSize: 13 }} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <input className="field" placeholder="Title, e.g. Where things live" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <textarea className="field" placeholder="What the agent should know" value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}
