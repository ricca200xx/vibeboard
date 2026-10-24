import { create } from 'zustand'
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { api, connectEvents, type LiveSession, type Loop } from './api'
import { agentById } from '../shared/agents.js'

export type ConsoleData = {
  agent: string
  name: string
  dot: string
  cwd: string
  yolo?: boolean
  sessionId?: string
  resumable?: string // last session that received a prompt: the one worth offering back
  lastSessionId?: string
  resumeOffer?: boolean
  resumeNext?: boolean
  epoch: number
}
export type GroupData = { label: string; color: string }
export type NoteData = { text: string; color: string }
export type TextData = { text: string }
export type WebData = { url: string }
export type GitCardData = { cwd: string }
export type KanbanData = { columns: { title: string; cards: string[] }[] }
export type InkData = { paths: string[]; color: string }

export type Memory = { id: string; title: string; kind: string; text: string; enabled: boolean }
export type Workspace = { id: string; name: string; nodes: Node[]; edges: Edge[]; viewport?: Viewport }
export type Project = { path: string; name: string; workspaces: Workspace[]; activeWs: string; memories: Memory[]; openedAt: number }
export type Preset = { id: string; name: string; agents: string[]; label?: string }

export type Tool = 'select' | 'spawn' | 'note' | 'text' | 'web' | 'ink' | 'eraser' | 'image' | 'kanban'
export type Modal = null | 'mission' | 'loops' | 'memory' | 'usage' | 'composer' | 'presets' | 'settings'
export type Settings = { yolo: boolean; fontSize: number; defaultAgent: string; speak?: boolean }

// Stable fallback so selectors never return a fresh [] (that re-renders forever).
export const EMPTY: Node[] = []

// How each console was last launched, keyed `${id}:${epoch}`. Valid only while that process
// lives: dropped on exit and when the server comes back without it.
export const launchCache = new Map<string, Record<string, string>>()
const forgetLaunch = (keep: (id: string) => boolean) => {
  for (const key of [...launchCache.keys()]) if (!keep(key.slice(0, key.lastIndexOf(':')))) launchCache.delete(key)
}

export const NAMES = ['Maya', 'Otto', 'Iris', 'Kai', 'Mila', 'Ren', 'Juno', 'Ada', 'Bex', 'Cy', 'Pip', 'Dax', 'Rafa', 'Lumi', 'Noor', 'Taro', 'Vera', 'Zed', 'Sol', 'Wren']
export const DOTS = ['#5b8cff', '#ff5a4e', '#a477ff', '#3ecf8e', '#f5b83d', '#ff7ac6', '#4fd1d9']
export const GROUP_COLORS = ['#e8643c', '#3ecf8e', '#5b8cff', '#a477ff', '#f5b83d']
export const CONSOLE_SIZE = { width: 640, height: 420 }

const uid = () => crypto.randomUUID().slice(0, 8)

const DEFAULT_PRESETS: Preset[] = [
  { id: 'duo', name: 'Pair', agents: ['claude', 'claude'] },
  { id: 'quad', name: 'Four Claudes', agents: ['claude', 'claude', 'claude', 'claude'] },
  { id: 'mixed', name: 'Claude + Codex + Gemini', agents: ['claude', 'codex', 'gemini'] },
  { id: 'review', name: 'Reviewers', agents: ['claude', 'claude', 'claude'], label: 'Reviewers' },
]

type S = {
  ready: boolean
  loaded: boolean
  liveReady: boolean
  projects: Project[]
  active: string | null
  live: Record<string, LiveSession>
  installed: string[]
  loops: Loop[]
  tool: Tool
  spawnAgent: string
  modal: Modal
  toast: string | null
  settings: Settings
  presets: Preset[]
  flow: ReactFlowInstance | null
  inkColor: string

  init: () => void
  set: (patch: Partial<S>) => void
  notify: (msg: string) => void
  openProject: (path: string) => void
  goHome: () => void
  forgetProject: (path: string) => void
  closeProject: () => Promise<void>
  addWorkspace: () => void
  switchWorkspace: (id: string) => void
  closeWorkspace: (id: string) => Promise<void>
  renameWorkspace: (id: string, name: string) => void
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  setViewport: (vp: Viewport) => void
  addNode: (node: Node) => void
  updateData: (id: string, patch: Record<string, unknown>) => void
  removeNode: (id: string) => Promise<void>
  addConsole: (agent: string, center: { x: number; y: number }, extra?: Partial<ConsoleData>, parentId?: string) => string
  restartConsole: (id: string) => Promise<void>
  resumeConsole: (id: string) => Promise<void>
  duplicateConsole: (id: string) => void
  spawnMany: (agents: string[], label?: string) => void
  groupSelected: (label?: string) => void
  ungroup: (id: string) => void
  pauseAll: () => void
  resumeAll: () => void
  sendTo: (ids: string[], text: string) => void
  frame: (ids: string[]) => void
  viewCenter: () => { x: number; y: number }
  savePreset: (preset: Omit<Preset, 'id'>) => void
  addMemory: (m: Omit<Memory, 'id'>) => void
  updateMemory: (id: string, patch: Partial<Memory>) => void
  removeMemory: (id: string) => void
}

export const project = (s: Pick<S, 'projects' | 'active'>) => s.projects.find((p) => p.path === s.active) ?? null
export const workspace = (s: Pick<S, 'projects' | 'active'>) => {
  const p = project(s)
  return p?.workspaces.find((w) => w.id === p.activeWs) ?? null
}
export const consoles = (nodes: Node[]) => nodes.filter((n) => n.type === 'console') as Node<ConsoleData>[]

const newWorkspace = (name: string): Workspace => ({ id: uid(), name, nodes: [], edges: [] })

// Absolute position, walking up group parents.
export function absolute(nodes: Node[], n: Node) {
  let { x, y } = n.position
  let parent = n.parentId ? nodes.find((p) => p.id === n.parentId) : undefined
  while (parent) {
    x += parent.position.x
    y += parent.position.y
    parent = parent.parentId ? nodes.find((p) => p.id === parent!.parentId) : undefined
  }
  return { x, y }
}

const sizeOf = (n: Node) => ({
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

function waitGone(id: string, ms = 3000) {
  return new Promise<void>((resolve) => {
    const t0 = Date.now()
    const tick = () => (!useStore.getState().live[id] || Date.now() - t0 > ms ? resolve() : setTimeout(tick, 50))
    tick()
  })
}

export const useStore = create<S>((set, get) => {
  const updateWs = (fn: (ws: Workspace) => Workspace) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.path !== s.active ? p : { ...p, workspaces: p.workspaces.map((w) => (w.id === p.activeWs ? fn(w) : w)) })),
    }))
  const updateProject = (fn: (p: Project) => Project) => set((s) => ({ projects: s.projects.map((p) => (p.path === s.active ? fn(p) : p)) }))

  const allocateName = () => {
    const p = project(get())
    const used = new Set(p?.workspaces.flatMap((w) => consoles(w.nodes).map((n) => n.data.name)) ?? [])
    for (let round = 1; ; round++)
      for (const n of NAMES) {
        const name = round === 1 ? n : `${n} ${round}`
        if (!used.has(name)) return name
      }
  }

  return {
    ready: false,
    loaded: false,
    liveReady: false,
    projects: [],
    active: null,
    live: {},
    installed: ['claude', 'shell'],
    loops: [],
    tool: 'select',
    spawnAgent: 'claude',
    modal: null,
    toast: null,
    settings: { yolo: false, fontSize: 13, defaultAgent: 'claude' },
    presets: DEFAULT_PRESETS,
    flow: null,
    inkColor: '#e8643c',

    init: () => {
      api.getState().then((saved) => {
        set({ ...(saved as Partial<S>), loaded: true })
        set((s) => ({ ready: s.liveReady }))
      })
      api.agents().then((installed) => set({ installed }))
      connectEvents((e) => {
        if (e.type === 'sessions') {
          const live = Object.fromEntries(e.sessions.map((x) => [x.id, x]))
          forgetLaunch((id) => !!live[id])
          set({ live, liveReady: true })
          set((s) => ({ ready: s.loaded }))
        } else if (e.type === 'spawn') set((s) => ({ live: { ...s.live, [e.session.id]: e.session } }))
        else if (e.type === 'status' || e.type === 'paused') {
          set((s) => {
            const cur = s.live[e.id]
            if (!cur) return {}
            const next = e.type === 'status' ? { ...cur, status: e.status } : { ...cur, paused: e.paused }
            return { live: { ...s.live, [e.id]: next } }
          })
        } else if (e.type === 'exit') {
          forgetLaunch((id) => id !== e.id)
          set((s) => {
            const live = { ...s.live }
            delete live[e.id]
            return { live }
          })
        } else if (e.type === 'session-id') {
          // Claude rotates the session id on /clear; keep the newest so resume picks the right chat.
          set((s) => ({
            projects: s.projects.map((p) => ({
              ...p,
              workspaces: p.workspaces.map((w) => ({
                ...w,
                nodes: w.nodes.map((n) => {
                  if (n.id !== e.id) return n
                  const d = n.data as ConsoleData
                  if (d.sessionId === e.sessionId && (!e.prompted || d.resumable === e.sessionId)) return n
                  return { ...n, data: { ...d, sessionId: e.sessionId, ...(e.prompted ? { resumable: e.sessionId } : {}) } }
                }),
              })),
            })),
          }))
        } else if (e.type === 'loops') set({ loops: e.loops })
      })
    },

    set: (patch) => set(patch),
    notify: (msg) => {
      set({ toast: msg })
      setTimeout(() => get().toast === msg && set({ toast: null }), 2600)
    },

    openProject: (path) =>
      set((s) => {
        const exists = s.projects.some((p) => p.path === path)
        const name = path.split('/').filter(Boolean).pop() || path
        const ws = newWorkspace('Workspace 1')
        const projects = exists
          ? s.projects.map((p) => (p.path === path ? { ...p, openedAt: Date.now() } : p))
          : [...s.projects, { path, name, workspaces: [ws], activeWs: ws.id, memories: [], openedAt: Date.now() }]
        return { projects, active: path, modal: null, tool: 'select' }
      }),

    goHome: () => set({ active: null, modal: null }),

    // Drops a project from Recent (its board too). Refused while any of its consoles runs.
    forgetProject: (path) => {
      const p = get().projects.find((x) => x.path === path)
      if (!p) return
      if (p.workspaces.some((w) => consoles(w.nodes).some((n) => get().live[n.id]))) return get().notify('Close its running consoles first')
      set((s) => ({ projects: s.projects.filter((x) => x.path !== path), active: s.active === path ? null : s.active }))
    },

    closeProject: async () => {
      const p = project(get())
      if (!p) return
      const ids = p.workspaces.flatMap((w) => consoles(w.nodes).map((n) => n.id)).filter((id) => get().live[id])
      if (ids.length && !confirm(`Close ${p.name}? ${ids.length} running console${ids.length > 1 ? 's' : ''} will be stopped. The board is kept.`)) return
      await Promise.all(ids.map((id) => api.kill(id).catch(() => {})))
      set({ active: null, modal: null })
    },

    addWorkspace: () =>
      updateProject((p) => {
        const ws = newWorkspace(`Workspace ${p.workspaces.length + 1}`)
        return { ...p, workspaces: [...p.workspaces, ws], activeWs: ws.id }
      }),

    switchWorkspace: (id) => updateProject((p) => ({ ...p, activeWs: id })),

    closeWorkspace: async (id) => {
      const p = project(get())
      if (!p || p.workspaces.length === 1) return get().notify('A project keeps at least one workspace')
      const ws = p.workspaces.find((w) => w.id === id)!
      const ids = consoles(ws.nodes).map((n) => n.id).filter((cid) => get().live[cid])
      if (ids.length && !confirm(`Close ${ws.name}? ${ids.length} running console${ids.length > 1 ? 's' : ''} will be stopped.`)) return
      await Promise.all(ids.map((cid) => api.kill(cid).catch(() => {})))
      updateProject((pr) => {
        const workspaces = pr.workspaces.filter((w) => w.id !== id)
        return { ...pr, workspaces, activeWs: pr.activeWs === id ? workspaces[0].id : pr.activeWs }
      })
    },

    renameWorkspace: (id, name) => updateProject((p) => ({ ...p, workspaces: p.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) })),

    onNodesChange: (changes) => updateWs((w) => ({ ...w, nodes: applyNodeChanges(changes, w.nodes) })),
    onEdgesChange: (changes) => updateWs((w) => ({ ...w, edges: applyEdgeChanges(changes, w.edges) })),
    setViewport: (viewport) => updateWs((w) => ({ ...w, viewport })),
    addNode: (node) => updateWs((w) => ({ ...w, nodes: [...w.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] })),
    updateData: (id, patch) => updateWs((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) })),

    removeNode: async (id) => {
      const ws = workspace(get())
      const node = ws?.nodes.find((n) => n.id === id)
      if (!node) return
      if (node.type === 'console' && get().live[id]) await api.kill(id).catch(() => {})
      updateWs((w) => ({
        ...w,
        // Removing a group frees its members instead of deleting them.
        nodes: w.nodes
          .filter((n) => n.id !== id)
          .map((n) => (n.parentId === id ? { ...n, parentId: undefined, extent: undefined, position: absolute(w.nodes, n) } : n)),
        edges: w.edges.filter((e) => e.source !== id && e.target !== id),
      }))
    },

    addConsole: (agent, center, extra, parentId) => {
      const id = `c-${uid()}`
      const p = project(get())!
      const node: Node<ConsoleData> = {
        id,
        type: 'console',
        position: { x: center.x - CONSOLE_SIZE.width / 2, y: center.y - CONSOLE_SIZE.height / 2 },
        style: { ...CONSOLE_SIZE },
        dragHandle: '.console-head',
        ...(parentId ? { parentId } : {}),
        data: {
          agent,
          name: allocateName(),
          dot: DOTS[Math.floor(Math.random() * DOTS.length)],
          cwd: p.path,
          yolo: get().settings.yolo,
          epoch: 0,
          ...extra,
        },
      }
      get().addNode(node)
      return id
    },

    restartConsole: async (id) => {
      if (get().live[id]) await api.kill(id).catch(() => {})
      await waitGone(id)
      const n = workspace(get())?.nodes.find((x) => x.id === id) as Node<ConsoleData> | undefined
      if (n) get().updateData(id, { epoch: n.data.epoch + 1, sessionId: undefined, resumeOffer: false, resumeNext: false })
    },

    // Relaunch the console on its previous conversation (the CLI's own --resume).
    resumeConsole: async (id) => {
      if (get().live[id]) await api.kill(id).catch(() => {})
      await waitGone(id)
      const n = workspace(get())?.nodes.find((x) => x.id === id) as Node<ConsoleData> | undefined
      if (n?.data.lastSessionId) get().updateData(id, { epoch: n.data.epoch + 1, resumeNext: true, resumeOffer: false })
    },

    duplicateConsole: (id) => {
      const ws = workspace(get())
      const n = ws?.nodes.find((x) => x.id === id) as Node<ConsoleData> | undefined
      if (!n) return
      const pos = absolute(ws!.nodes, n)
      const { width } = sizeOf(n)
      const spot = freeSpot(ws!.nodes, { x: pos.x + width + 40, y: pos.y, width: CONSOLE_SIZE.width, height: CONSOLE_SIZE.height })
      get().addConsole(n.data.agent, { x: spot.x + CONSOLE_SIZE.width / 2, y: spot.y + CONSOLE_SIZE.height / 2 }, { yolo: n.data.yolo, cwd: n.data.cwd })
    },

    // Centre of the view, nudged to free space for a console-sized node.
    viewCenter: () => {
      const flow = get().flow
      const c = flow ? flow.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 - 40 }) : { x: 0, y: 0 }
      const { width, height } = CONSOLE_SIZE
      const spot = freeSpot(workspace(get())?.nodes ?? [], { x: c.x - width / 2, y: c.y - height / 2, width, height })
      return { x: spot.x + width / 2, y: spot.y + height / 2 }
    },

    spawnMany: (agents, label) => {
      if (!agents.length) return
      const cols = agents.length <= 4 ? Math.min(2, agents.length) : agents.length <= 9 ? 3 : 4
      const rows = Math.ceil(agents.length / cols)
      const gap = 28
      const { width, height } = CONSOLE_SIZE
      const center = get().viewCenter()
      const pad = 24
      const head = label ? 44 : 0
      const totalW = cols * width + (cols - 1) * gap
      const totalH = rows * height + (rows - 1) * gap
      const nodes = workspace(get())?.nodes ?? []
      const spot = freeSpot(nodes, { x: center.x - totalW / 2 - pad, y: center.y - totalH / 2 - pad - head, width: totalW + pad * 2, height: totalH + pad * 2 + head })
      const origin = { x: spot.x + pad, y: spot.y + pad + head }
      let gid: string | undefined
      if (label) {
        gid = `g-${uid()}`
        const color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)]
        get().addNode({
          id: gid,
          type: 'group',
          position: { x: origin.x - pad, y: origin.y - pad - head },
          style: { width: totalW + pad * 2, height: totalH + pad * 2 + head },
          data: { label, color } satisfies GroupData,
        })
      }
      const ids = agents.map((agent, i) => {
        const cx = (i % cols) * (width + gap) + width / 2
        const cy = Math.floor(i / cols) * (height + gap) + height / 2
        return gid ? get().addConsole(agent, { x: pad + cx, y: pad + head + cy }, undefined, gid) : get().addConsole(agent, { x: origin.x + cx, y: origin.y + cy })
      })
      setTimeout(() => get().frame(gid ? [gid] : ids), 60)
    },

    groupSelected: (label) => {
      const ws = workspace(get())
      if (!ws) return
      const picked = ws.nodes.filter((n) => n.selected && n.type !== 'group' && !n.parentId)
      if (!picked.length) return get().notify('Select consoles on the board first')
      const pad = 24
      const head = 44
      const gap = 28
      // Members are re-laid in a compact grid (reading order), so the frame never swallows
      // a console that is not part of the group.
      const sorted = [...picked].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      const cols = Math.ceil(Math.sqrt(sorted.length))
      const sizes = sorted.map(sizeOf)
      const colW = Array.from({ length: cols }, (_, c) => Math.max(...sizes.filter((_, i) => i % cols === c).map((s) => s.width)))
      const rows = Math.ceil(sorted.length / cols)
      const rowH = Array.from({ length: rows }, (_, r) => Math.max(...sizes.filter((_, i) => Math.floor(i / cols) === r).map((s) => s.height)))
      const offsetX = (c: number) => pad + colW.slice(0, c).reduce((a, b) => a + b + gap, 0)
      const offsetY = (r: number) => pad + head + rowH.slice(0, r).reduce((a, b) => a + b + gap, 0)
      const width = offsetX(cols) - gap + pad
      const height = offsetY(rows) - gap + pad
      const ids = new Set(picked.map((n) => n.id))
      const origin = freeSpot(
        ws.nodes.filter((n) => !ids.has(n.id)),
        { x: Math.min(...picked.map((n) => n.position.x)) - pad, y: Math.min(...picked.map((n) => n.position.y)) - pad - head, width, height },
      )
      const gid = `g-${uid()}`
      const groupCount = ws.nodes.filter((n) => n.type === 'group').length
      const group: Node<GroupData> = {
        id: gid,
        type: 'group',
        position: origin,
        style: { width, height },
        data: { label: label || `Group ${groupCount + 1}`, color: GROUP_COLORS[groupCount % GROUP_COLORS.length] },
      }
      const slot = new Map(sorted.map((n, i) => [n.id, { x: offsetX(i % cols), y: offsetY(Math.floor(i / cols)) }]))
      updateWs((w) => ({
        ...w,
        // Parents must come before children in React Flow's node array.
        nodes: [group, ...w.nodes.map((n) => (ids.has(n.id) ? { ...n, parentId: gid, selected: false, position: slot.get(n.id)! } : n))],
      }))
      setTimeout(() => get().frame([gid]), 60)
    },

    ungroup: (id) => get().removeNode(id),

    pauseAll: () => {
      const ws = workspace(get())
      const ids = consoles(ws?.nodes ?? []).map((n) => n.id).filter((id) => get().live[id] && !get().live[id].paused)
      ids.forEach((id) => api.signal(id, 'SIGSTOP').catch(() => {}))
      get().notify(ids.length ? `Paused ${ids.length} console${ids.length > 1 ? 's' : ''}` : 'Nothing running to pause')
    },

    resumeAll: () => {
      const ws = workspace(get())
      const ids = consoles(ws?.nodes ?? []).map((n) => n.id).filter((id) => get().live[id]?.paused)
      ids.forEach((id) => api.signal(id, 'SIGCONT').catch(() => {}))
      get().notify(ids.length ? `Resumed ${ids.length} console${ids.length > 1 ? 's' : ''}` : 'Nothing paused')
    },

    sendTo: (ids, text) => ids.forEach((id) => get().live[id] && api.prompt(id, text).catch(() => {})),

    frame: (ids) => get().flow?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.15, duration: 450, maxZoom: 1 }),

    savePreset: (preset) => set((s) => ({ presets: [...s.presets, { ...preset, id: uid() }] })),

    addMemory: (m) => updateProject((p) => ({ ...p, memories: [...p.memories, { ...m, id: uid() }] })),
    updateMemory: (id, patch) => updateProject((p) => ({ ...p, memories: p.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
    removeMemory: (id) => updateProject((p) => ({ ...p, memories: p.memories.filter((m) => m.id !== id) })),
  }
})

// ---------- persistence ----------
let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((s, prev) => {
  if (!s.loaded) return
  if (s.projects === prev.projects && s.active === prev.active && s.settings === prev.settings && s.presets === prev.presets) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { projects, active, settings, presets } = useStore.getState()
    const clean = projects.map((p) => ({
      ...p,
      workspaces: p.workspaces.map((w) => ({ ...w, nodes: w.nodes.map(({ selected: _s, dragging: _d, ...n }) => n) })),
    }))
    api.putState({ projects: clean, active, settings, presets }).catch((e) => console.error('save failed', e))
  }, 400)
})

export const agentColor = (id: string) => agentById(id)?.color ?? '#9a948c'
