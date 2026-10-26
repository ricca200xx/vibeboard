import { memo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { ArrowRight, Circle, Diamond, Minus, Square, StickyNote } from 'lucide-react'
import { useStore, type ShapeData, type ShapeKind } from '../store'
import { PAPER } from './Nodes'

export const SHAPE_DEFAULTS: Omit<ShapeData, 'kind'> = { stroke: '#ece8e2', fill: 'none', strokeWidth: 2, dash: 'solid', round: true, opacity: 1, text: '' }
const isLine = (k: ShapeKind) => k === 'line' || k === 'arrow'
const nid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`

function ShapeNodeImpl({ id, data, selected, width = 160, height = 100 }: NodeProps<Node<ShapeData>>) {
  const [editing, setEditing] = useState(false)
  const sw = data.strokeWidth
  const dash = data.dash === 'dashed' ? `${sw * 4} ${sw * 3}` : data.dash === 'dotted' ? `0 ${sw * 2.6}` : undefined
  const paint = {
    stroke: data.stroke,
    strokeWidth: sw,
    strokeDasharray: dash,
    strokeLinecap: 'round' as const,
    strokeLinejoin: (data.round ? 'round' : 'miter') as 'round' | 'miter',
    fill: data.fill,
  }
  const w = width
  const h = height
  const i = sw / 2
  let shape: React.ReactNode
  if (data.kind === 'rect') shape = <rect x={i} y={i} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={data.round ? Math.min(16, w / 5, h / 5) : 0} {...paint} />
  else if (data.kind === 'ellipse') shape = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - i)} ry={Math.max(0, h / 2 - i)} {...paint} />
  else if (data.kind === 'diamond') shape = <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} {...paint} />
  else {
    const [a, b, c, d] = data.points ?? [0, 0.5, 1, 0.5]
    const [x1, y1, x2, y2] = [a * w, b * h, c * w, d * h]
    const ang = Math.atan2(y2 - y1, x2 - x1)
    const len = 10 + sw * 2
    const head = (s: number) => `${x2 - len * Math.cos(ang + s)},${y2 - len * Math.sin(ang + s)}`
    shape = (
      <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...paint} fill="none" />
        {data.kind === 'arrow' && <polyline points={`${head(-0.45)} ${x2},${y2} ${head(0.45)}`} {...paint} strokeDasharray={undefined} fill="none" />}
      </>
    )
  }
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={isLine(data.kind) ? 8 : 30} minHeight={isLine(data.kind) ? 8 : 30} />
      <div className="shape-node" style={{ opacity: data.opacity }} onDoubleClick={() => !isLine(data.kind) && setEditing(true)}>
        <svg width={w} height={h}>{shape}</svg>
        {!isLine(data.kind) &&
          (editing ? (
            <textarea
              className="nodrag nowheel label"
              autoFocus
              defaultValue={data.text}
              style={{ color: data.stroke }}
              onBlur={(e) => {
                useStore.getState().updateData(id, { text: e.target.value })
                setEditing(false)
              }}
              onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
            />
          ) : (
            data.text && (
              <div className="label" style={{ color: data.stroke }}>
                {data.text}
              </div>
            )
          ))}
      </div>
    </>
  )
}
export const ShapeNode = memo(ShapeNodeImpl)

// While the Shapes tool is on: drag to draw the picked shape, or click to drop one at its default size.
export function ShapeLayer() {
  const tool = useStore((s) => s.tool)
  const kind = useStore((s) => s.shapeKind)
  const flow = useReactFlow()
  const start = useRef<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  if (tool !== 'shape') return null
  const finish = (x: number, y: number) => {
    const s = start.current
    start.current = null
    setBox(null)
    if (!s) return
    const a = flow.screenToFlowPosition(s)
    const b = flow.screenToFlowPosition({ x, y })
    const store = useStore.getState()
    const dragged = Math.hypot(b.x - a.x, b.y - a.y) > 8
    if (isLine(kind)) {
      // A click lays a default horizontal line; a drag goes from where it started to where it ended.
      const [p, q] = dragged ? [a, b] : [{ x: a.x - 80, y: a.y }, { x: a.x + 80, y: a.y }]
      const pad = 12
      const x0 = Math.min(p.x, q.x) - pad
      const y0 = Math.min(p.y, q.y) - pad
      const w = Math.abs(q.x - p.x) + pad * 2
      const h = Math.abs(q.y - p.y) + pad * 2
      store.addNode({
        id: nid('s'),
        type: 'shape',
        position: { x: x0, y: y0 },
        width: w,
        height: h,
        data: { ...SHAPE_DEFAULTS, kind, points: [(p.x - x0) / w, (p.y - y0) / h, (q.x - x0) / w, (q.y - y0) / h] },
      })
    } else {
      const w = dragged ? Math.max(30, Math.abs(b.x - a.x)) : 160
      const h = dragged ? Math.max(30, Math.abs(b.y - a.y)) : 100
      const at = dragged ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) } : { x: a.x - w / 2, y: a.y - h / 2 }
      store.addNode({ id: nid('s'), type: 'shape', position: at, width: w, height: h, data: { ...SHAPE_DEFAULTS, kind } })
    }
    store.set({ tool: 'select' })
  }
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 15, cursor: 'crosshair' }}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => start.current && setBox({ x0: start.current.x, y0: start.current.y, x1: e.clientX, y1: e.clientY })}
      onPointerUp={(e) => finish(e.clientX, e.clientY)}
    >
      {box &&
        (isLine(kind) ? (
          <line x1={box.x0} y1={box.y0} x2={box.x1} y2={box.y1} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 5" />
        ) : (
          <rect
            x={Math.min(box.x0, box.x1)}
            y={Math.min(box.y0, box.y1)}
            width={Math.abs(box.x1 - box.x0)}
            height={Math.abs(box.y1 - box.y0)}
            rx={kind === 'ellipse' ? 999 : 8}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        ))}
    </svg>
  )
}

const KINDS: { kind: ShapeKind | 'sticky'; label: string; icon: React.ReactNode }[] = [
  { kind: 'rect', label: 'Rectangle', icon: <Square size={17} /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <Circle size={17} /> },
  { kind: 'diamond', label: 'Diamond', icon: <Diamond size={17} /> },
  { kind: 'line', label: 'Line', icon: <Minus size={17} style={{ transform: 'rotate(-45deg)' }} /> },
  { kind: 'arrow', label: 'Arrow', icon: <ArrowRight size={17} style={{ transform: 'rotate(-45deg)' }} /> },
  { kind: 'sticky', label: 'Sticky', icon: <StickyNote size={17} /> },
]

export function ShapesMenu({ onClose }: { onClose: () => void }) {
  const set = useStore((s) => s.set)
  const tool = useStore((s) => s.tool)
  const kind = useStore((s) => s.shapeKind)
  return (
    <div className="shapes-menu" onMouseLeave={onClose}>
      <div className="section-label">Shapes</div>
      <div className="grid">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            className={(k.kind === 'sticky' ? tool === 'note' : tool === 'shape' && kind === k.kind) ? 'on' : ''}
            onClick={() => {
              if (k.kind === 'sticky') set({ tool: 'note' })
              else set({ tool: 'shape', shapeKind: k.kind })
              onClose()
            }}
          >
            {k.icon}
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export const newSticky = (at: { x: number; y: number }) => ({
  id: nid('n'),
  type: 'note',
  position: { x: at.x - 90, y: at.y - 75 },
  style: { width: 180, height: 150 },
  data: { text: '', color: PAPER[0] },
})
