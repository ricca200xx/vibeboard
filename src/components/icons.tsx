import { SquareTerminal } from 'lucide-react'
import { agentById } from '../../shared/agents.js'

// Our own burst glyph for Claude (not the vendor logo).
export function Spark({ size = 18, color = '#e8643c' }: { size?: number; color?: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6 + 0.13
    const r = i % 2 ? 6.2 : 9.4
    return <line key={i} x1={12} y1={12} x2={12 + Math.cos(a) * r} y2={12 + Math.sin(a) * r} />
  })
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth={2.1} strokeLinecap="round" aria-hidden>
      {rays}
    </svg>
  )
}

export function AgentGlyph({ id, size = 18 }: { id: string; size?: number }) {
  const a = agentById(id)
  const color = a?.color ?? '#9a948c'
  if (id === 'claude') return <Spark size={size} color={color} />
  if (id === 'shell') return <SquareTerminal size={size} color={color} strokeWidth={1.8} />
  return (
    <span style={{ color, fontSize: size * 0.8, fontWeight: 800, lineHeight: 1, fontFamily: 'var(--mono)' }}>
      {(a?.name ?? '?').slice(0, 1).toLowerCase()}
    </span>
  )
}

export function AgentIcon({ id, size = 34 }: { id: string; size?: number }) {
  const color = agentById(id)?.color ?? '#9a948c'
  return (
    <span
      className="agent-icon"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 16%, #1d1b19)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <AgentGlyph id={id} size={size * 0.55} />
    </span>
  )
}
