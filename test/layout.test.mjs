// Group re-flow geometry (src/layout.ts runs as-is under Node's TypeScript type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridLayout } from '../src/layout.ts'

const W = 640
const H = 420
const PAD = 24
const HEAD = 44
const GAP = 60
const node = (id, x, y) => ({ id, position: { x, y }, data: {}, style: { width: W, height: H } })

test('a group grows to fit a newcomer and keeps reading order', () => {
  const two = gridLayout([node('a', 24, 68), node('b', 724, 68)])
  assert.deepEqual([two.width, two.height], [PAD + W + GAP + W + PAD, PAD + HEAD + H + PAD])

  // A third console dropped below the row: the frame grows to a 2x2 grid and it takes the next slot.
  const three = gridLayout([node('a', 24, 68), node('b', 724, 68), node('c', 300, 600)])
  assert.deepEqual([three.width, three.height], [PAD + W + GAP + W + PAD, PAD + HEAD + H + GAP + H + PAD])
  assert.deepEqual(three.slots.get('c'), { x: PAD, y: PAD + HEAD + H + GAP })

  // Dropped at the start of the row: it goes first and the others shift along.
  const first = gridLayout([node('a', 24, 68), node('b', 724, 68), node('n', 0, 80)])
  assert.deepEqual(first.slots.get('n'), { x: PAD, y: PAD + HEAD })
  assert.deepEqual(first.slots.get('a'), { x: PAD + W + GAP, y: PAD + HEAD })
})

test('an empty group keeps a drop target size', () => {
  const empty = gridLayout([])
  assert.deepEqual([empty.width, empty.height, empty.slots.size], [380, 220, 0])
})
