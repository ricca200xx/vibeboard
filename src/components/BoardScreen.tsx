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
  Settings2,
  Type,
  X,
  Check,
  ChevronRight,
  LayoutGrid,
} from 'lucide-react'
import { api } from '../api'
import { absolute, consoles, project, useStore, workspace, type ConsoleData, type Tool } from '../store'
import { AGENTS } from '../../shared/agents.js'
import { ConsoleNode } from './ConsoleNode'
import { GroupNode, ImageNode, InkNode, KanbanNode, NOTE_COLORS, NoteNode, TextNode, WebNode } from './Nodes'
import { AgentIcon, Spark } from './icons'
import { TopBar } from './TopBar'
import { BottomBar, GitPill } from './BottomBar'
import { MissionMap } from './MissionMap'
import { LoopsModal } from './LoopsModal'
import { MemoryModal } from './MemoryModal'
import { SettingsModal, UsagePanel } from './Panels'

const nodeTypes = {
  console: ConsoleNode,
  group: GroupNode,
  note: NoteNode,
  text: TextNode,
  web: WebNode,
  kanban: KanbanNode,
  image: ImageNode,
  ink: InkNode,
}

const nid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`

export function BoardScreen() {
  const modal = useStore((s) => s.modal)
  return (
    <ReactFlowProvider>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Board />
        <InkLayer />
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
        {modal === 'mission' && <MissionMap />}
        {modal === 'loops' && <LoopsModal />}
        {modal === 'memory' && <MemoryModal />}
        {modal === 'settings' && <SettingsModal />}
        {modal === 'usage' && <UsagePanel />}
      </div>
    </ReactFlowProvider>
  )
}

function addImage(file: File, at: { x: number; y: number }) {
  if (!file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    const img = new window.Image()
    img.onload = () => {
      const scale = Math.min(1, 480 / Math.max(img.width, img.height))
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)
      useStore.getState().addNode({ id: nid('i'), type: 'image', position: { x: at.x - width / 2, y: at.y - height / 2 }, style: { width, height }, data: { src: reader.result } })
    }
    img.src = String(reader.result)
  }
  reader.readAsDataURL(file)
}

function Board() {
  const ws = useStore(workspace)!
  const tool = useStore((s) => s.tool)
  const flow = useReactFlow()
  const { onNodesChange, onEdgesChange, setViewport, set } = useStore.getState()

  useEffect(() => set({ flow }), [flow])

  // Backspace removes notes, text, ink and images; consoles only die from their own confirmed close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable], .xterm')) return
      const s = useStore.getState()
      if (e.key === 'Escape') s.set({ tool: 'select', modal: null })
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
      s.addNode({ id: nid('n'), type: 'note', position: { x: pos.x - 110, y: pos.y - 100 }, style: { width: 220, height: 200 }, data: { text: '', color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)] } })
    else if (s.tool === 'text') s.addNode({ id: nid('t'), type: 'text', position: { x: pos.x, y: pos.y - 18 }, data: { text: '' } })
    else if (s.tool === 'web')
      s.addNode({ id: nid('w'), type: 'web', position: { x: pos.x - 360, y: pos.y - 240 }, style: { width: 720, height: 480 }, data: { url: 'http://localhost:3000' } })
    else return
    set({ tool: 'select' })
  }

  // Dropping a node inside a group adopts it; dragging it out releases it.
  const onDragStop = (_: unknown, node: Node) => {
    if (node.type === 'group') return
    const s = useStore.getState()
    const nodes = workspace(s)!.nodes
    const abs = absolute(nodes, node)
    const w = node.measured?.width ?? 0
    const h = node.measured?.height ?? 0
    const cx = abs.x + w / 2
    const cy = abs.y + h / 2
    const host = nodes.find(
      (g) => g.type === 'group' && g.id !== node.id && cx > g.position.x && cx < g.position.x + (g.measured?.width ?? 0) && cy > g.position.y && cy < g.position.y + (g.measured?.height ?? 0),
    )
    if (host?.id === node.parentId) return
    // Moved to the end of the array: React Flow needs parents before children.
    useStore.setState((st) => ({
      projects: st.projects.map((p) =>
        p.path !== st.active
          ? p
          : {
              ...p,
              workspaces: p.workspaces.map((wsp) => {
                if (wsp.id !== p.activeWs) return wsp
                const rest = wsp.nodes.filter((n) => n.id !== node.id)
                const moved = { ...wsp.nodes.find((n) => n.id === node.id)!, parentId: host?.id, position: host ? { x: abs.x - host.position.x, y: abs.y - host.position.y } : abs }
                if (!host) delete moved.parentId
                return { ...wsp, nodes: [...rest, moved] }
              }),
            },
      ),
    }))
  }

  return (
    <div
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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        defaultViewport={ws.viewport ?? { x: 120, y: 80, zoom: 0.9 }}
        onMoveEnd={(_, vp) => setViewport(vp)}
        onPaneClick={place}
        onNodeDragStop={onDragStop}
        onNodeClick={(_, n) => {
          const s = useStore.getState()
          if (s.tool === 'eraser' && n.type !== 'console' && n.type !== 'group') s.removeNode(n.id)
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
    </div>
  )
}

const TOOLS: { tool: Tool; icon: React.ReactNode; tip: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={19} fill="currentColor" />, tip: 'Select' },
  { tool: 'spawn', icon: <Spark size={21} />, tip: 'Spawn agent' },
  { tool: 'note', icon: <Copy size={19} />, tip: 'Sticky note' },
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
  const [menu, setMenu] = useState(false)

  const pick = (t: Tool) => {
    set({ tool: tool === t && t !== 'select' ? 'select' : t })
    setMenu(t === 'spawn' && tool !== 'spawn')
  }

  return (
    <>
      <div className="toolbar">
        {TOOLS.map((t) => (
          <button key={t.tool} className={`tool-btn ${tool === t.tool ? 'active' : ''}`} data-tip={t.tip} onClick={() => pick(t.tool)}>
            {t.tool === 'spawn' && tool === 'spawn' ? <Spark size={21} color="#fff" /> : t.icon}
          </button>
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
          <button key={t.tool} className={`tool-btn ${tool === t.tool ? 'active' : ''}`} data-tip={t.tip} onClick={() => pick(t.tool)}>
            {t.icon}
          </button>
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
      {menu && tool === 'spawn' && <SpawnMenu onClose={() => setMenu(false)} />}
    </>
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

function RightToolbar() {
  const s = useStore.getState()
  const items = [
    { icon: <Layers size={18} />, tip: 'Mission map', run: () => s.set({ modal: 'mission' }) },
    {
      icon: <ListChecks size={18} />,
      tip: 'Kanban',
      run: () => {
        const c = s.viewCenter()
        s.addNode({
          id: nid('k'),
          type: 'kanban',
          position: { x: c.x - 320, y: c.y - 180 },
          style: { width: 640, height: 360 },
          data: { columns: [{ title: 'To do', cards: [] }, { title: 'Doing', cards: [] }, { title: 'Done', cards: [] }] },
        })
      },
    },
    { icon: <Settings2 size={18} />, tip: 'Settings', run: () => s.set({ modal: 'settings' }) },
    { icon: <Folder size={18} />, tip: 'Open in Finder', run: () => api.reveal(project(useStore.getState())!.path) },
    { icon: <FileText size={18} />, tip: 'Memory', run: () => s.set({ modal: 'memory' }) },
    { icon: <Repeat size={18} />, tip: 'Loops', run: () => s.set({ modal: 'loops' }) },
  ]
  return (
    <div className="toolbar right">
      {items.map((i) => (
        <button key={i.tip} className="tool-btn" data-tip={i.tip} onClick={i.run}>
          {i.icon}
        </button>
      ))}
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
  const flow = useReactFlow()
  const [pts, setPts] = useState<{ x: number; y: number }[] | null>(null)
  if (tool !== 'ink') return null
  const toD = (p: { x: number; y: number }[]) => p.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ')
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 15, cursor: 'crosshair' }}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture(e.pointerId)
        setPts([{ x: e.clientX, y: e.clientY }])
      }}
      onPointerMove={(e) => pts && setPts([...pts, { x: e.clientX, y: e.clientY }])}
      onPointerUp={() => {
        if (pts && pts.length > 1) {
          const f = pts.map((p) => flow.screenToFlowPosition(p))
          const x0 = Math.min(...f.map((p) => p.x)) - 4
          const y0 = Math.min(...f.map((p) => p.y)) - 4
          const x1 = Math.max(...f.map((p) => p.x)) + 4
          const y1 = Math.max(...f.map((p) => p.y)) + 4
          useStore.getState().addNode({
            id: nid('ink'),
            type: 'ink',
            position: { x: x0, y: y0 },
            width: x1 - x0,
            height: y1 - y0,
            data: { paths: [toD(f.map((p) => ({ x: p.x - x0, y: p.y - y0 })))], color },
          })
        }
        setPts(null)
      }}
    >
      {pts && <path d={toD(pts)} fill="none" stroke={color} strokeWidth={3 * flow.getZoom()} strokeLinecap="round" strokeLinejoin="round" />}
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
