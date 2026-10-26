import { useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react'
import { ArrowRight, Check, Trash2, Zap } from 'lucide-react'
import { useStore, type HandoffData } from '../store'

// The wire leaves and enters on the sides facing each other, wherever the consoles are now
// (groups re-flow them), instead of always right -> left looping around the board.
export function facingSides(a: InternalNode, b: InternalNode) {
  const box = (n: InternalNode) => {
    const { x, y } = n.internals.positionAbsolute
    const w = n.measured.width ?? 0
    const h = n.measured.height ?? 0
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
  }
  const s = box(a)
  const t = box(b)
  const dx = t.cx - s.cx
  const dy = t.cy - s.cy
  if (Math.abs(dx) / (s.w + t.w) >= Math.abs(dy) / (s.h + t.h)) {
    return dx >= 0
      ? { sourceX: s.x + s.w, sourceY: s.cy, sourcePosition: Position.Right, targetX: t.x, targetY: t.cy, targetPosition: Position.Left }
      : { sourceX: s.x, sourceY: s.cy, sourcePosition: Position.Left, targetX: t.x + t.w, targetY: t.cy, targetPosition: Position.Right }
  }
  return dy >= 0
    ? { sourceX: s.cx, sourceY: s.y + s.h, sourcePosition: Position.Bottom, targetX: t.cx, targetY: t.y, targetPosition: Position.Top }
    : { sourceX: s.cx, sourceY: s.y, sourcePosition: Position.Top, targetX: t.cx, targetY: t.y + t.h, targetPosition: Position.Bottom }
}

// A lead's helper: a quiet dashed line back to the lead. No pill, there is nothing to set on it.
export function HelperEdge({ id, source, target, ...geo }: EdgeProps) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path] = getBezierPath(a && b ? facingSides(a, b) : geo)
  return <BaseEdge id={id} path={path} className="helper-edge" />
}

// A hand-off wire: work flows from the source console to the target. The pill in the middle says
// when that happens and opens the few things you can do with a wire.
export function HandoffEdge({ id, source, target, data, markerEnd, ...geo }: EdgeProps<Edge<HandoffData>>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path, x, y] = getBezierPath(a && b ? facingSides(a, b) : geo)
  const busy = useStore((s) => !!s.handing[`${source}>${target}`])
  const [menu, setMenu] = useState(false)
  const auto = data?.auto ?? true
  const s = useStore.getState()

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`handoff-edge ${busy ? 'busy' : ''} ${auto ? '' : 'manual'}`} />
      <EdgeLabelRenderer>
        <div className="handoff-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
          <button className={`handoff-pill ${busy ? 'busy' : ''}`} onClick={() => setMenu((v) => !v)} title="What this link does">
            {busy ? (
              <>
                <span className="sa-dot" /> Handing off…
              </>
            ) : (
              <>
                <ArrowRight size={13} /> {auto ? 'When done' : 'On demand'}
              </>
            )}
          </button>
          {menu && (
            <div className="menu handoff-menu" onMouseLeave={() => setMenu(false)}>
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(false)
                  s.handoff(source, target)
                }}
              >
                <Zap size={15} /> Hand off now
              </button>
              <button className="menu-item" onClick={() => s.setEdgeData(id, { auto: !auto })}>
                <span style={{ width: 15, display: 'inline-flex' }}>{auto && <Check size={15} />}</span> Automatically when it finishes
              </button>
              <button className="menu-item danger" onClick={() => s.removeEdge(id)}>
                <Trash2 size={15} /> Remove link
              </button>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

// A memory card's wire to a console it feeds; nothing flows until Push.
export function MemoryEdge({ id, source, target, ...geo }: EdgeProps) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path] = getBezierPath(a && b ? facingSides(a, b) : geo)
  return <BaseEdge id={id} path={path} className="memory-edge" />
}

// An orchestrator's command wire: a warm curve with a pulse running toward the agents it drives.
export function CommandEdge({ id, source, target, ...geo }: EdgeProps) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const [path] = getBezierPath(a && b ? facingSides(a, b) : geo)
  return (
    <>
      <BaseEdge id={id} path={path} className="command-edge" />
      <circle r={3.5} className="command-pulse">
        <animateMotion dur="2.8s" repeatCount="indefinite" path={path} />
      </circle>
    </>
  )
}
