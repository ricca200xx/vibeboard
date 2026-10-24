// Pure board geometry: no store, no DOM, so it runs under plain `node --test` too.
import type { Node } from '@xyflow/react'

export const CONSOLE_SIZE = { width: 640, height: 420 }
export const GROUP_PAD = 24
export const GROUP_HEAD = 44
const GROUP_GAP = 28
const EMPTY_GROUP = { width: 380, height: 220 }

export const sizeOf = (n: Node) => ({
  width: n.measured?.width ?? n.width ?? (n.style?.width as number) ?? CONSOLE_SIZE.width,
  height: n.measured?.height ?? n.height ?? (n.style?.height as number) ?? CONSOLE_SIZE.height,
})

// Slide a rect right past whatever top-level node it would cover, so auto-placed nodes never overlap.
export function freeSpot(nodes: Node[], rect: { x: number; y: number; width: number; height: number }) {
  const boxes = nodes.filter((n) => !n.parentId).map((n) => ({ ...n.position, ...sizeOf(n) }))
  let { x } = rect
  for (let guard = 0; guard < 200; guard++) {
    const hit = boxes.find((b) => x < b.x + b.width + 32 && x + rect.width + 32 > b.x && rect.y < b.y + b.height + 32 && rect.y + rect.height + 32 > b.y)
    if (!hit) break
    x = hit.x + hit.width + 40
  }
  return { x, y: rect.y }
}

// Members in reading order (a row is anything within 120px vertically), laid out in a near-square
// grid inside the group frame. Positions are relative to the group; returns the frame size too.
export function gridLayout(members: Node[]) {
  if (!members.length) return { slots: new Map<string, { x: number; y: number }>(), ...EMPTY_GROUP }
  const sorted = [...members].sort((a, b) => (Math.abs(a.position.y - b.position.y) > 120 ? a.position.y - b.position.y : a.position.x - b.position.x))
  const cols = Math.ceil(Math.sqrt(sorted.length))
  const rows = Math.ceil(sorted.length / cols)
  const sizes = sorted.map(sizeOf)
  const colW = Array.from({ length: cols }, (_, c) => Math.max(...sizes.filter((_, i) => i % cols === c).map((s) => s.width)))
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...sizes.filter((_, i) => Math.floor(i / cols) === r).map((s) => s.height)))
  const offsetX = (c: number) => GROUP_PAD + colW.slice(0, c).reduce((a, b) => a + b + GROUP_GAP, 0)
  const offsetY = (r: number) => GROUP_PAD + GROUP_HEAD + rowH.slice(0, r).reduce((a, b) => a + b + GROUP_GAP, 0)
  return {
    slots: new Map(sorted.map((n, i) => [n.id, { x: offsetX(i % cols), y: offsetY(Math.floor(i / cols)) }])),
    width: offsetX(cols) - GROUP_GAP + GROUP_PAD,
    height: offsetY(rows) - GROUP_GAP + GROUP_PAD,
  }
}
