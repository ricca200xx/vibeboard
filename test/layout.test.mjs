// Group re-flow geometry (src/layout.ts runs as-is under Node's TypeScript type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridLayout } from '../src/layout.ts'

const node = (id, x, y) => ({ id, position: { x, y }, data: {}, style: { width: 640, height: 420 } })

test('a group grows to fit a newcomer and keeps reading order', () => {
  const two = gridLayout([node('a', 24, 68), node('b', 692, 68)])
  assert.deepEqual([two.width, two.height], [24 + 640 + 28 + 640 + 24, 24 + 44 + 420 + 24])

  // A third console dropped below the row: the frame grows to a 2x2 grid and it takes the next slot.
  const three = gridLayout([node('a', 24, 68), node('b', 692, 68), node('c', 300, 600)])
  assert.deepEqual([three.width, three.height], [1356, 24 + 44 + 420 + 28 + 420 + 24])
  assert.deepEqual(three.slots.get('c'), { x: 24, y: 24 + 44 + 420 + 28 })

  // Dropped at the start of the row: it goes first and the others shift along.
  const first = gridLayout([node('a', 24, 68), node('b', 692, 68), node('n', 0, 80)])
  assert.deepEqual(first.slots.get('n'), { x: 24, y: 68 })
  assert.deepEqual(first.slots.get('a'), { x: 24 + 640 + 28, y: 68 })
})

test('an empty group keeps a drop target size', () => {
  const empty = gridLayout([])
  assert.deepEqual([empty.width, empty.height, empty.slots.size], [380, 220, 0])
})
