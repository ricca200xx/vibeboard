import { useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Node,
} from '@xyflow/react'
import {
  Copy,
  Eraser,
  FileText,
  Folder,
  Globe,
  Image,
  Layers,
  ListChecks,
  Maximize2,
  Minus,
  Monitor,
  MousePointer2,
  PenTool,
  Plus,
  Repeat,
  RotateCcwClock,
  Orbit,
  Type,
  X,
  Check,
  CalendarDays,
  Columns3,
  Pipette,
  ChevronRight,
  LayoutGrid,
} from 'lucide-react'
import { api } from '../api'
import { addImage, addOrchestrator, insertCard, nid } from '../board'
import { absolute, consoles, useStore, workspace, type ConsoleData, type Tool } from '../store'
import { AGENTS } from '../../shared/agents.js'
import { ConsoleNode } from './ConsoleNode'
import { CommandEdge, HandoffEdge, HelperEdge, MemoryEdge } from './HandoffEdge'
import { OrchestratorNode } from './Orchestrator'
import { CodeNode, CodeStudio } from './CodeStudio'
import { ContextMenu, type MenuAt } from './ContextMenu'
import { GroupNode, ImageNode, InkNode, NoteNode, TextNode } from './Nodes'
import { newWebData, WebTile } from './WebTile'
import { BoardNode, CalendarNode, ChecklistNode, NEW_BOARD } from './Planner'
import { newSticky, ShapeLayer, ShapeNode, ShapesMenu } from './Shapes'
import { Inspector } from './Inspector'
import { AgentIcon, ClaudeMark } from './icons'
import { TopBar } from './TopBar'
import { BottomBar } from './BottomBar'
import { GitPill } from './GitPanel'
import { MissionMap } from './MissionMap'
import { LoopsModal } from './LoopsModal'
import { MemoryCard, MemoryModal } from './MemoryModal'
import { SettingsModal } from './Panels'
import { UsagePanel } from './UsagePanel'

const nodeTypes = {
  console: ConsoleNode,
  group: GroupNode,
  note: NoteNode,
  text: TextNode,
  web: WebTile,
  kanban: BoardNode,
  calendar: CalendarNode,
  checklist: ChecklistNode,
  shape: ShapeNode,
  image: ImageNode,
  ink: InkNode,
  memory: MemoryCard,
  orchestrator: OrchestratorNode,
  code: CodeNode,
}

const edgeTypes = { handoff: HandoffEdge, helper: HelperEdge, memory: MemoryEdge, command: CommandEdge }


// Moved nodes go last, followed by their own children (an image's ink): parents before children.
const reorder = (nodes: Node[], moves: Map<string, Node>) => {
  const kids = nodes.filter((n) => n.parentId && moves.has(n.parentId) && !moves.has(n.id))
  return [...nodes.filter((n) => !moves.has(n.id) && !kids.includes(n)), ...moves.values(), ...kids]
}

export function BoardScreen() {
  const modal = useStore((s) => s.modal)
  return (
    <ReactFlowProvider>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Board />
        <InkLayer />
        <ShapeLayer />
        <Inspector />
        <TopBar />
        <LeftToolbar />
        <RightToolbar />
        <BottomBar />
        <div className="corner left">
          <GitPill />
        </div>
        <div className="corner right">
          <Zoom />
        </div>
        <ResumeAllToast />
        <ReportVisible />
        {modal === 'mission' && <MissionMap />}
        {modal === 'loops' && <LoopsModal />}
        {modal === 'memory' && <MemoryModal />}
        {modal === 'settings' && <SettingsModal />}
        {modal === 'usage' && <UsagePanel />}
        {modal === 'code' && <CodeStudio />}
      </div>
    </ReactFlowProvider>
  )
}

function Board() {
  const ws = useStore(workspace)!
  const tool = useStore((s) => s.tool)
  const flow = useReactFlow()
  const { onNodesChange, onEdgesChange, setViewport, set } = useStore.getState()
  const [wiring, setWiring] = useState(false) // a wire is being dragged: every console becomes a drop target
  const [menu, setMenu] = useState<MenuAt | null>(null)

  useEffect(() => set({ flow }), [flow])

  // Backspace removes notes, text, ink and images; consoles only die from their own confirmed close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable], .xterm')) return
      const s = useStore.getState()
      if (e.key === 'Escape') s.set({ tool: 'select', modal: null, connecting: null })
      if (e.key === 'Backspace' || e.key === 'Delete') {
        workspace(s)
          ?.nodes.filter((n) => n.selected && n.type !== 'console')
          .forEach((n) => s.removeNode(n.id))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault()
        flow.fitView({ padding: 0.12, duration: 400 })
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [flow])

  const place = (e: React.MouseEvent) => {
    const s = useStore.getState()
    const pos = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if (s.tool === 'spawn') s.addConsole(s.spawnAgent, pos)
    else if (s.tool === 'note')
      s.addNode(newSticky(pos))
    else if (s.tool === 'text') s.addNode({ id: nid('t'), type: 'text', position: { x: pos.x, y: pos.y - 18 }, data: { text: '' } })
    else if (s.tool === 'web')
      s.addNode({ id: nid('w'), type: 'web', position: { x: pos.x - 360, y: pos.y - 240 }, style: { width: 720, height: 480 }, data: newWebData() })
    else return
    set({ tool: 'select' })
  }

  // Dropping a node inside a group adopts it; dragging it out releases it. With a multi-selection
  // every dragged node is judged on its own position, not only the one under the pointer.
  // Every group touched re-flows afterwards: it grows to take a newcomer, shrinks when one
  // leaves, and a drag inside a group reorders it.
  const onDragStop = (_: unknown, _node: Node, dragged: Node[]) => {
    const nodes = workspace(useStore.getState())!.nodes
    const moves = new Map<string, Node>()
    const touched = new Set<string>()
    for (const node of dragged) {
      if (node.type === 'group' || node.type === 'ink') continue // ink stays where it was drawn, never joins a group
      const abs = absolute(nodes, node)
      const cx = abs.x + (node.measured?.width ?? 0) / 2
      const cy = abs.y + (node.measured?.height ?? 0) / 2
      const host = nodes.find(
        (g) => g.type === 'group' && g.id !== node.id && cx > g.position.x && cx < g.position.x + (g.measured?.width ?? 0) && cy > g.position.y && cy < g.position.y + (g.measured?.height ?? 0),
      )
      if (node.parentId) touched.add(node.parentId)
      if (host) touched.add(host.id)
      if (host?.id === node.parentId) continue
      const moved = { ...nodes.find((n) => n.id === node.id)!, parentId: host?.id, position: host ? { x: abs.x - host.position.x, y: abs.y - host.position.y } : abs }
      if (!host) delete moved.parentId
      moves.set(node.id, moved)
    }
    const refit = () => touched.forEach((g) => useStore.getState().fitGroup(g))
    if (!moves.size) return refit()
    // Moved to the end of the array: React Flow needs parents before children.
    useStore.setState((st) => ({
      projects: st.projects.map((p) =>
        p.path !== st.active
          ? p
          : {
              ...p,
              workspaces: p.workspaces.map((wsp) =>
                wsp.id !== p.activeWs ? wsp : { ...wsp, nodes: reorder(wsp.nodes, moves) },
              ),
            },
      ),
    }))
    refit()
  }

  return (
    <div
      className={wiring ? 'wiring' : undefined}
      style={{ position: 'absolute', inset: 0 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        ;[...e.dataTransfer.files].forEach((f) => addImage(f, at))
      }}
    >
      <ReactFlow
        key={ws.id}
        nodes={ws.nodes}
        edges={ws.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnectStart={() => setWiring(true)}
        onConnectEnd={() => setWiring(false)}
        onConnect={(c) => {
          const s = useStore.getState()
          if (!s.connectConsoles(c.source, c.target)) return
          const fromCard = ws.nodes.some((n) => n.id === c.source && n.type === 'memory')
          s.notify(fromCard ? 'Wired: Push on the card types the memory into this console' : 'Linked: work passes along whenever the first one finishes')
        }}
        isValidConnection={(c) => c.source !== c.target}
        defaultViewport={ws.viewport ?? { x: 120, y: 80, zoom: 0.9 }}
        onMoveEnd={(_, vp) => setViewport(vp)}
        onPaneClick={place}
        onNodeDragStop={onDragStop}
        onNodeClick={(_, n) => {
          const s = useStore.getState()
          if (s.tool === 'eraser' && n.type !== 'console' && n.type !== 'group') s.removeNode(n.id)
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
        }}
        onNodeContextMenu={(e, node) => {
          // Inside a terminal the right click stays the terminal's (copy, paste).
          if ((e.target as HTMLElement).closest('.xterm, input, textarea')) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), node })
        }}
        minZoom={0.08}
        maxZoom={2.5}
        panOnScroll
        zoomOnPinch
        zoomOnScroll={false}
        selectionOnDrag={tool === 'select'}
        panOnDrag={[1, 2]}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        selectionKeyCode={null}
        panActivationKeyCode={null} // space is push-to-talk; pan with two fingers or the middle button
        className={tool !== 'select' ? 'placing' : ''}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={34} size={1.7} color="#38342f" />
      </ReactFlow>
      {menu && <ContextMenu at={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

const TOOLS: { tool: Tool; icon: React.ReactNode; tip: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={19} fill="currentColor" />, tip: 'Select' },
  { tool: 'spawn', icon: <ClaudeMark size={20} />, tip: 'Spawn agent' },
  { tool: 'shape', icon: <Copy size={19} />, tip: 'Shapes' },
]
const TOOLS_2: { tool: Tool; icon: React.ReactNode; tip: string }[] = [
  { tool: 'text', icon: <Type size={19} />, tip: 'Text' },
  { tool: 'ink', icon: <PenTool size={18} />, tip: 'Ink' },
  { tool: 'eraser', icon: <Eraser size={18} />, tip: 'Eraser' },
  { tool: 'web', icon: <Globe size={19} />, tip: 'Web tile' },
]

function LeftToolbar() {
  const tool = useStore((s) => s.tool)
  const set = useStore((s) => s.set)
  const flow = useReactFlow()
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<'spawn' | 'shape' | null>(null)
  const isOn = (t: Tool) => tool === t || (t === 'shape' && tool === 'note') // a sticky is picked from the Shapes menu

  const pick = (t: Tool) => {
    set({ tool: isOn(t) && t !== 'select' ? 'select' : t })
    setMenu((t === 'spawn' || t === 'shape') && !isOn(t) ? t : null)
  }

  return (
    <>
      <div className="toolbar">
        {TOOLS.map((t) => (
          <span key={t.tool} style={{ position: 'relative', display: 'grid' }}>
            <button className={`tool-btn ${isOn(t.tool) ? 'active' : ''}`} data-tip={menu === t.tool ? undefined : t.tip} onClick={() => pick(t.tool)}>
              {t.tool === 'spawn' && tool === 'spawn' ? <ClaudeMark size={20} color="#fff" /> : t.icon}
            </button>
            {t.tool === 'shape' && menu === 'shape' && <ShapesMenu onClose={() => setMenu(null)} />}
          </span>
        ))}
        <button
          className="tool-btn"
          data-tip="Shell console"
          onClick={() => {
            const s = useStore.getState()
            s.addConsole('shell', s.viewCenter())
          }}
        >
          <Monitor size={19} />
        </button>
        {TOOLS_2.map((t) => (
          <span key={t.tool} style={{ position: 'relative', display: 'grid' }}>
            <button className={`tool-btn ${tool === t.tool ? 'active' : ''}`} data-tip={tool === t.tool && t.tool === 'ink' ? undefined : t.tip} onClick={() => pick(t.tool)}>
              {t.icon}
            </button>
            {t.tool === 'ink' && tool === 'ink' && <InkPanel />}
          </span>
        ))}
        <button className="tool-btn" data-tip="Image" onClick={() => fileRef.current?.click()}>
          <Image size={19} />
        </button>
        <div className="sep" />
        <button className="tool-btn" data-tip="Fit board (⌘0)" onClick={() => flow.fitView({ padding: 0.12, duration: 400 })}>
          <Maximize2 size={18} />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          ;[...(e.target.files ?? [])].forEach((f) => addImage(f, useStore.getState().viewCenter()))
          e.target.value = ''
        }}
      />
      {menu === 'spawn' && tool === 'spawn' && <SpawnMenu onClose={() => setMenu(null)} />}
    </>
  )
}

const INK_COLORS = ['#ece8e2', '#f0553a', '#5fae6a', '#c9a64e', '#ef4444', '#6fd6ee', '#a98bfa', '#5d6a86']
const INK_WIDTHS = [2, 3, 5, 8, 12]

function InkPanel() {
  const color = useStore((s) => s.inkColor)
  const width = useStore((s) => s.inkWidth)
  const set = useStore((s) => s.set)
  const custom = !INK_COLORS.includes(color)
  return (
    <div className="ink-panel">
      <div className="section-label">Color</div>
      <div className="row">
        {INK_COLORS.map((c) => (
          <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => set({ inkColor: c })} />
        ))}
        <label className={`swatch custom ${custom ? 'on' : ''}`} style={custom ? { background: color } : undefined} title="Custom color">
          <Pipette size={11} />
          <input type="color" value={color} onChange={(e) => set({ inkColor: e.target.value })} />
        </label>
      </div>
      <div className="section-label">Width</div>
      <div className="row">
        {INK_WIDTHS.map((w) => (
          <button key={w} className={`width ${width === w ? 'on' : ''}`} title={`${w}px`} onClick={() => set({ inkWidth: w })}>
            <i style={{ width: Math.max(4, w * 1.2), height: Math.max(4, w * 1.2) }} />
          </button>
        ))}
      </div>
    </div>
  )
}

const FEATURED = ['claude', 'aider', 'cursor', 'qwen', 'codex', 'shell']

function SpawnMenu({ onClose }: { onClose: () => void }) {
  const spawnAgent = useStore((s) => s.spawnAgent)
  const installed = useStore((s) => s.installed)
  const set = useStore((s) => s.set)
  const [all, setAll] = useState(false)
  const list = all ? AGENTS : AGENTS.filter((a) => FEATURED.includes(a.id))
  return (
    <div className="menu spawn-menu nowheel" style={{ top: 'calc(50% - 250px)' }}>
      <div className="menu-title">Spawn agent</div>
      {list.map((a) => (
        <button
          key={a.id}
          className="menu-item"
          onClick={() => {
            set({ spawnAgent: a.id })
            onClose()
          }}
        >
          <AgentIcon id={a.id} />
          <span style={{ flex: 1 }}>
            <div className="title">{a.name}</div>
            <div className="sub">{installed.includes(a.id) ? a.sub : 'not installed'}</div>
          </span>
          {spawnAgent === a.id && <Check size={17} color="var(--accent)" />}
        </button>
      ))}
      {!all && (
        <button className="menu-item" onClick={() => setAll(true)}>
          <LayoutGrid size={17} color="var(--muted)" style={{ margin: '0 8px' }} />
          <span style={{ flex: 1, fontWeight: 500 }}>All agents</span>
          <span style={{ color: 'var(--faint)', fontSize: 13 }}>{AGENTS.length}</span>
          <ChevronRight size={15} color="var(--faint)" />
        </button>
      )}
      <div className="menu-hint">then click the canvas to drop it</div>
    </div>
  )
}

// Tells the server which consoles are on screen, for loops that pause behind other tabs.
function ReportVisible() {
  const ids = useStore((s) => consoles(workspace(s)?.nodes ?? []).map((n) => n.id).join(','))
  useEffect(() => {
    const send = () => api.visible(ids ? ids.split(',') : []).catch(() => {})
    send()
    const t = setInterval(send, 20_000)
    return () => {
      clearInterval(t)
      api.visible([]).catch(() => {})
    }
  }, [ids])
  return null
}

function RightToolbar() {
  const s = useStore.getState()
  const running = useStore((st) => st.loops.filter((l) => l.active && (!l.scope || l.scope === st.active)).length)
  const [todo, setTodo] = useState(false)
  const items = [
    { icon: <Layers size={18} />, tip: 'Mission map', run: () => s.set({ modal: 'mission' }) },
    { icon: <ListChecks size={18} />, tip: 'To-do', run: () => setTodo((v) => !v) },
    { icon: <Orbit size={18} />, tip: 'Orchestrator', run: () => addOrchestrator() },
    { icon: <Folder size={18} />, tip: 'Code', run: () => s.set({ modal: 'code' }) },
    { icon: <FileText size={18} />, tip: 'Memory', run: () => s.set({ modal: 'memory' }) },
    { icon: <Repeat size={18} />, tip: 'Loops', run: () => s.set({ modal: 'loops' }) },
  ]
  return (
    <div className="toolbar right">
      {items.map((i) => (
        <span key={i.tip} style={{ position: 'relative', display: 'grid' }}>
          <button className={`tool-btn ${i.tip === 'To-do' && todo ? 'on' : ''}`} data-tip={i.tip === 'To-do' && todo ? undefined : i.tip} onClick={i.run}>
            {i.icon}
            {i.tip === 'Loops' && running > 0 && <span className="tool-badge">{running}</span>}
          </button>
          {i.tip === 'To-do' && todo && <TodoMenu onClose={() => setTodo(false)} />}
        </span>
      ))}
    </div>
  )
}

// Drops a fresh checklist, board or calendar in the middle of the view.
function TodoMenu({ onClose }: { onClose: () => void }) {
  const insert = (type: string, width: number, height: number, data: Record<string, unknown>) => {
    insertCard(type, width, height, data)
    onClose()
  }
  return (
    <div className="todo-menu" onMouseLeave={onClose}>
      <div className="section-label">Insert to-do</div>
      <button onClick={() => insert('checklist', 300, 340, { items: [] })}>
        <ListChecks size={15} /> Checklist
      </button>
      <button onClick={() => insert('kanban', 1060, 440, structuredClone(NEW_BOARD))}>
        <Columns3 size={15} /> Board (kanban)
      </button>
      <button onClick={() => insert('calendar', 600, 500, { events: [] })}>
        <CalendarDays size={15} /> Calendar
      </button>
    </div>
  )
}

function Zoom() {
  const { zoom } = useViewport()
  const flow = useReactFlow()
  return (
    <div className="pill zoom">
      <button className="icon-btn sm" onClick={() => flow.zoomOut({ duration: 200 })}>
        <Minus size={14} />
      </button>
      <span onDoubleClick={() => flow.zoomTo(1, { duration: 250 })}>{Math.round(zoom * 100)}%</span>
      <button className="icon-btn sm" onClick={() => flow.zoomIn({ duration: 200 })}>
        <Plus size={14} />
      </button>
    </div>
  )
}

function InkLayer() {
  const tool = useStore((s) => s.tool)
  const color = useStore((s) => s.inkColor)
  const width = useStore((s) => s.inkWidth)
  const flow = useReactFlow()
  // The stroke lives in a ref: pointer events can arrive faster than React re-renders.
  const stroke = useRef<{ x: number; y: number }[] | null>(null)
  const [pts, setPts] = useState<{ x: number; y: number }[] | null>(null)
  if (tool !== 'ink') return null
  const toD = (p: { x: number; y: number }[]) => p.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ')
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 15, cursor: 'crosshair' }}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture(e.pointerId)
        stroke.current = [{ x: e.clientX, y: e.clientY }]
        setPts(stroke.current)
      }}
      onPointerMove={(e) => {
        if (!stroke.current) return
        stroke.current = [...stroke.current, { x: e.clientX, y: e.clientY }]
        setPts(stroke.current)
      }}
      onPointerUp={() => {
        const pts = stroke.current
        stroke.current = null
        if (pts && pts.length > 1) {
          const f = pts.map((p) => flow.screenToFlowPosition(p))
          const pad = width / 2 + 2
          const x0 = Math.min(...f.map((p) => p.x)) - pad
          const y0 = Math.min(...f.map((p) => p.y)) - pad
          const x1 = Math.max(...f.map((p) => p.x)) + pad
          const y1 = Math.max(...f.map((p) => p.y)) + pad
          // A stroke that starts on an image annotates it: it rides along when the image moves.
          const nodes = workspace(useStore.getState())!.nodes
          const image = [...nodes].reverse().find((n) => {
            if (n.type !== 'image') return false
            const a = absolute(nodes, n)
            return f[0].x >= a.x && f[0].y >= a.y && f[0].x <= a.x + (n.measured?.width ?? 0) && f[0].y <= a.y + (n.measured?.height ?? 0)
          })
          const at = image ? absolute(nodes, image) : { x: 0, y: 0 }
          useStore.getState().addNode({
            id: nid('ink'),
            type: 'ink',
            position: { x: x0 - at.x, y: y0 - at.y },
            ...(image ? { parentId: image.id } : {}),
            zIndex: 10, // above images and cards
            width: x1 - x0,
            height: y1 - y0,
            data: { paths: [toD(f.map((p) => ({ x: p.x - x0, y: p.y - y0 })))], color, width },
          })
        }
        setPts(null)
      }}
    >
      {pts && <path d={toD(pts)} fill="none" stroke={color} strokeWidth={width * flow.getZoom()} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

function ResumeAllToast() {
  const offers = useStore((s) => consoles(workspace(s)?.nodes ?? []).filter((n) => n.data.resumeOffer && n.data.lastSessionId).length)
  const [hidden, setHidden] = useState(false)
  if (!offers || hidden) return null
  const resumeAll = async () => {
    const s = useStore.getState()
    const list = consoles(workspace(s)!.nodes).filter((n) => n.data.resumeOffer && n.data.lastSessionId) as Node<ConsoleData>[]
    for (const n of list) {
      const { exists } = await api.claudeSession(n.data.lastSessionId!)
      if (exists) s.resumeConsole(n.id)
      else s.updateData(n.id, { resumeOffer: false })
    }
    setHidden(true)
  }
  return (
    <div className="board-toast">
      <RotateCcwClock size={18} color="var(--accent)" />
      <span>
        <div className="t">Resume all conversations?</div>
        <div className="s">
          {offers} console{offers > 1 ? 's' : ''} can pick up their last chat
        </div>
      </span>
      <button className="btn primary" onClick={resumeAll}>
        Yes
      </button>
      <button className="icon-btn sm" onClick={() => setHidden(true)}>
        <X size={14} />
      </button>
    </div>
  )
}
