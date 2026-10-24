import { create } from 'zustand'
import {
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { api, connectEvents, type LiveSession, type Loop, type Status } from './api'
import { agentById } from '../shared/agents.js'
import { CONSOLE_SIZE, GROUP_HEAD, GROUP_PAD, freeSpot, gridLayout, sizeOf, wouldCycle } from './layout'

export { CONSOLE_SIZE, freeSpot }

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
  role?: string // what this agent is for; travels with every hand-off it receives
  epoch: number
}
export type HandoffData = { auto: boolean }
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
export type Settings = { yolo: boolean; fontSize: number; defaultAgent: string; speak?: boolean; notify?: boolean }

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
  handing: Record<string, boolean> // `${from}>${to}` while a hand-off is being summarised

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
  addConsole: (agent: string, center: { x: number; y: number }, extra?: Partial<ConsoleData>, parentId?: string, reveal?: boolean) => string
  restartConsole: (id: string, fresh?: boolean) => Promise<void>
  resumeConsole: (id: string) => Promise<void>
  duplicateConsole: (id: string) => void
  spawnMany: (agents: string[], label?: string) => void
  groupSelected: (label?: string) => void
  fitGroup: (id: string) => void
  ungroup: (id: string) => void
  pauseAll: () => void
  resumeAll: () => void
  sendTo: (ids: string[], text: string) => number
  frame: (ids: string[]) => void
  jumpTo: (id: string) => void
  connectConsoles: (source: string, target: string) => boolean
  handoff: (from: string, to: string) => Promise<void>
  setEdgeData: (id: string, patch: Partial<HandoffData>) => void
  removeEdge: (id: string) => void
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

export function findConsole(s: Pick<S, 'projects'>, id: string) {
  for (const project of s.projects)
    for (const ws of project.workspaces) {
      const node = ws.nodes.find((n) => n.id === id && n.type === 'console') as Node<ConsoleData> | undefined
      if (node) return { project, ws, node }
    }
  return null
}

// Tell the user when an agent needs them or has finished. In the window: a toast for "needs you"
// only (finishing is visible on the board). Elsewhere: a system notification that jumps back to it.
function announce(id: string, status: Status) {
  if (status !== 'needs' && status !== 'done') return
  const s = useStore.getState()
  const hit = findConsole(s, id)
  if (!hit) return
  const text = status === 'needs' ? `${hit.node.data.name} needs you` : `${hit.node.data.name} finished`
  if (document.hasFocus()) {
    if (status === 'needs') s.notify(text)
    return
  }
  if (s.settings.notify === false || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const n = new Notification(text, { body: hit.project.name, tag: id })
  n.onclick = () => {
    window.focus()
    useStore.getState().jumpTo(id)
    n.close()
  }
}

// A plain shell would run each line of a hand-off brief as a command (one could say `rm …`),
// so work only ever goes to agent consoles.
function refuseShell(id: string) {
  const d = findConsole(useStore.getState(), id)?.node.data
  if (d?.agent !== 'shell') return false
  useStore.getState().notify(`${d.name} is a plain shell and would run the hand-off as commands. Pick an agent console.`)
  return true
}

// A console just finished: every automatic wire leaving it hands its work on.
function autoHandoff(id: string) {
  const s = useStore.getState()
  const hit = findConsole(s, id)
  if (!hit) return
  for (const e of hit.ws.edges) if (e.source === id && (e.data as HandoffData | undefined)?.auto) s.handoff(id, e.target)
}

// Ask once, from a click (browsers only show the prompt after a user gesture).
export function askNotifyPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
}

// Nodes glide to their new place instead of jumping (see `.relayout` in styles.css).
const glide = () => {
  document.body.classList.add('relayout')
  setTimeout(() => document.body.classList.remove('relayout'), 350)
}

// Resolves true once the process is gone. The server escalates to SIGKILL at 4s, so 5s is enough.
function waitGone(id: string, ms = 5000) {
  return new Promise<boolean>((resolve) => {
    const t0 = Date.now()
    const tick = () => (!useStore.getState().live[id] ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(tick, 50))
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
    handing: {},

    init: () => {
      // Retried: under `node --watch` the page can load while the server is restarting.
      const load = () =>
        api
          .getState()
          .then((saved) => {
            set({ ...(saved as Partial<S>), loaded: true })
            set((s) => ({ ready: s.liveReady }))
          })
          .catch(() => setTimeout(load, 1000))
      load()
      api.agents().then((installed) => set({ installed })).catch((e) => console.error('agent detection failed', e))
      connectEvents((e) => {
        if (e.type === 'sessions') {
          const live = Object.fromEntries(e.sessions.map((x) => [x.id, x]))
          forgetLaunch((id) => !!live[id])
          set({ live, liveReady: true })
          set((s) => ({ ready: s.loaded }))
        } else if (e.type === 'spawn') set((s) => ({ live: { ...s.live, [e.session.id]: e.session } }))
        else if (e.type === 'status' || e.type === 'paused') {
          const before = get().live[e.id]?.status
          set((s) => {
            const cur = s.live[e.id]
            if (!cur) return {}
            const next = e.type === 'status' ? { ...cur, status: e.status } : { ...cur, paused: e.paused }
            return { live: { ...s.live, [e.id]: next } }
          })
          if (e.type === 'status' && before && before !== e.status) {
            announce(e.id, e.status)
            if (e.status === 'done') autoHandoff(e.id)
          }
        } else if (e.type === 'exit') {
          forgetLaunch((id) => id !== e.id)
          set((s) => {
            const live = { ...s.live }
            delete live[e.id]
            return { live }
          })
        } else if (e.type === 'session-id') {
          // Claude rotates the session id on /clear; keep the newest so resume picks the right chat.
          // This fires on every tool call, so an unchanged node returns the same state (no re-render, no save).
          set((s) => {
            const d = s.projects.flatMap((p) => p.workspaces.flatMap((w) => w.nodes)).find((n) => n.id === e.id)?.data as ConsoleData | undefined
            if (!d || (d.sessionId === e.sessionId && (!e.prompted || (d.resumable === e.sessionId && !d.resumeOffer)))) return s
            // A prompt reached the new conversation (keyboard, command bar, loop...): the old one is no longer on offer.
            const patch = { sessionId: e.sessionId, ...(e.prompted ? { resumable: e.sessionId, resumeOffer: false } : {}) }
            return {
              projects: s.projects.map((p) => ({
                ...p,
                workspaces: p.workspaces.map((w) =>
                  w.nodes.some((n) => n.id === e.id) ? { ...w, nodes: w.nodes.map((n) => (n.id === e.id ? { ...n, data: { ...n.data, ...patch } } : n)) } : w,
                ),
              })),
            }
          })
        } else if (e.type === 'loops') set({ loops: e.loops })
        else if (e.type === 'handoff')
          set((s) => {
            const handing = { ...s.handing }
            if (e.state === 'summarizing') handing[`${e.from}>${e.to}`] = true
            else delete handing[`${e.from}>${e.to}`]
            return { handing }
          })
        else if (e.type === 'subagents')
          set((s) => (s.live[e.id] ? { live: { ...s.live, [e.id]: { ...s.live[e.id], subagents: e.subagents } } } : {}))
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
      if (node.parentId) get().fitGroup(node.parentId)
    },

    addConsole: (agent, center, extra, parentId, reveal = true) => {
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
      // The first console is the natural moment to ask: from here on there is something to be told about.
      if (get().settings.notify !== false) askNotifyPermission()
      // Auto-placement may land off screen: pan (same zoom) so the new console is in view.
      if (reveal) setTimeout(() => {
        const flow = get().flow
        const n = flow?.getInternalNode(id)
        if (!flow || !n) return
        const { x, y } = n.internals.positionAbsolute
        const tl = flow.flowToScreenPosition({ x, y })
        const br = flow.flowToScreenPosition({ x: x + CONSOLE_SIZE.width, y: y + CONSOLE_SIZE.height })
        if (tl.x < 0 || tl.y < 0 || br.x > innerWidth || br.y > innerHeight)
          flow.setCenter(x + CONSOLE_SIZE.width / 2, y + CONSOLE_SIZE.height / 2, { zoom: flow.getZoom(), duration: 350 })
      }, 60)
      return id
    },

    // fresh: an explicit restart starts clean; Relaunch after an exit keeps the conversation on offer.
    restartConsole: async (id, fresh = true) => {
      if (get().live[id]) await api.kill(id).catch(() => {})
      if (!(await waitGone(id))) return get().notify('Still stopping, try again in a moment')
      const n = workspace(get())?.nodes.find((x) => x.id === id) as Node<ConsoleData> | undefined
      if (n)
        get().updateData(id, { epoch: n.data.epoch + 1, sessionId: undefined, resumeOffer: false, resumeNext: false, ...(fresh ? { resumable: undefined } : {}) })
    },

    // Relaunch the console on its previous conversation (the CLI's own --resume).
    resumeConsole: async (id) => {
      if (get().live[id]) await api.kill(id).catch(() => {})
      if (!(await waitGone(id))) return get().notify('Still stopping, try again in a moment')
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
      const gap = 60 // same as a group's re-flow (layout.ts), so the first drop doesn't reshuffle it
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
        // spawnMany frames the whole batch itself, so no per-console reveal.
        return gid
          ? get().addConsole(agent, { x: pad + cx, y: pad + head + cy }, undefined, gid, false)
          : get().addConsole(agent, { x: origin.x + cx, y: origin.y + cy }, undefined, undefined, false)
      })
      setTimeout(() => get().frame(gid ? [gid] : ids), 60)
    },

    groupSelected: (label) => {
      const ws = workspace(get())
      if (!ws) return
      const picked = ws.nodes.filter((n) => n.selected && n.type !== 'group' && !n.parentId)
      if (!picked.length) return get().notify('Select consoles on the board first')
      // Members are re-laid in a compact grid (reading order), so the frame never swallows
      // a console that is not part of the group.
      const { slots: slot, width, height } = gridLayout(picked)
      const ids = new Set(picked.map((n) => n.id))
      const origin = freeSpot(
        ws.nodes.filter((n) => !ids.has(n.id)),
        { x: Math.min(...picked.map((n) => n.position.x)) - GROUP_PAD, y: Math.min(...picked.map((n) => n.position.y)) - GROUP_PAD - GROUP_HEAD, width, height },
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
      updateWs((w) => ({
        ...w,
        // Parents must come before children in React Flow's node array.
        nodes: [group, ...w.nodes.map((n) => (ids.has(n.id) ? { ...n, parentId: gid, selected: false, position: slot.get(n.id)! } : n))],
      }))
      setTimeout(() => get().frame([gid]), 60)
    },

    // A group always wraps its members: re-lay them in reading order and size the frame to fit.
    // ponytail: a growing group can overlap its neighbours; push them aside if that bites.
    fitGroup: (id) => {
      glide()
      updateWs((w) => {
        if (!w.nodes.some((n) => n.id === id && n.type === 'group')) return w
        const { slots, width, height } = gridLayout(w.nodes.filter((n) => n.parentId === id))
        return {
          ...w,
          nodes: w.nodes.map((n) =>
            n.id === id ? { ...n, width, height, style: { ...n.style, width, height } } : slots.has(n.id) ? { ...n, position: slots.get(n.id)! } : n,
          ),
        }
      })
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

    // Returns how many consoles were actually running, so callers report the real count.
    sendTo: (ids, text) => {
      const live = ids.filter((id) => get().live[id])
      live.forEach((id) => api.prompt(id, text).catch((e) => get().notify(`Send failed: ${e.message}`)))
      return live.length
    },

    frame: (ids) => get().flow?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.15, duration: 450, maxZoom: 1 }),

    // A wire between two consoles: when the source finishes, its work is handed to the target.
    connectConsoles: (source, target) => {
      const ws = workspace(get())
      if (!ws || source === target) return false
      const isConsole = (id: string) => ws.nodes.some((n) => n.id === id && n.type === 'console')
      if (!isConsole(source) || !isConsole(target)) return false
      if (refuseShell(target)) return false
      if (ws.edges.some((e) => e.source === source && e.target === target)) return false
      if (wouldCycle(ws.edges, source, target)) {
        get().notify('That would pass work around in a circle. Use a loop for repeating work.')
        return false
      }
      const edge: Edge<HandoffData> = {
        id: `h-${uid()}`,
        source,
        target,
        type: 'handoff',
        data: { auto: true },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      }
      updateWs((w) => ({ ...w, edges: [...w.edges, edge] }))
      return true
    },

    handoff: async (from, to) => {
      const name = (id: string) => findConsole(get(), id)?.node.data
      const a = name(from)
      const b = name(to)
      if (!a || !b || refuseShell(to)) return
      if (!get().live[to]) return get().notify(`${b.name} is not running`)
      try {
        const r = await api.handoff({ from, to, fromName: a.name, toName: b.name, role: b.role })
        if (!r.duplicate) get().notify(`${a.name} handed off to ${b.name}`)
      } catch (e) {
        get().notify(`Hand-off failed: ${(e as Error).message}`)
      }
    },

    setEdgeData: (id, patch) => updateWs((w) => ({ ...w, edges: w.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) })),
    removeEdge: (id) => updateWs((w) => ({ ...w, edges: w.edges.filter((e) => e.id !== id) })),

    // Open whichever project and workspace hold this console, then centre it.
    jumpTo: (id) => {
      const hit = findConsole(get(), id)
      if (!hit) return
      set((s) => ({
        active: hit.project.path,
        modal: null,
        projects: s.projects.map((p) => (p.path === hit.project.path ? { ...p, activeWs: hit.ws.id } : p)),
      }))
      setTimeout(() => get().frame([id]), 120)
    },

    savePreset: (preset) => set((s) => ({ presets: [...s.presets, { ...preset, id: uid() }] })),

    addMemory: (m) => updateProject((p) => ({ ...p, memories: [...p.memories, { ...m, id: uid() }] })),
    updateMemory: (id, patch) => updateProject((p) => ({ ...p, memories: p.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
    removeMemory: (id) => updateProject((p) => ({ ...p, memories: p.memories.filter((m) => m.id !== id) })),
  }
})

// ---------- persistence ----------
const snapshot = () => {
  const { projects, active, settings, presets } = useStore.getState()
  const clean = projects.map((p) => ({
    ...p,
    workspaces: p.workspaces.map((w) => ({ ...w, nodes: w.nodes.map(({ selected: _s, dragging: _d, ...n }) => n) })),
  }))
  return { projects: clean, active, settings, presets }
}

// One PUT in flight at a time: two racing uploads could land an older state last.
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving = false
let dirty = false
async function save() {
  saveTimer = undefined
  if (saving) return void (dirty = true)
  saving = true
  try {
    await api.putState(snapshot())
  } catch (e) {
    useStore.getState().notify(`Save failed: ${(e as Error).message}`)
  } finally {
    saving = false
    if (dirty) {
      dirty = false
      save()
    }
  }
}

useStore.subscribe((s, prev) => {
  if (!s.loaded) return
  if (s.projects === prev.projects && s.active === prev.active && s.settings === prev.settings && s.presets === prev.presets) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 400)
})

// The window title counts the agents waiting for you, so it shows in the Dock and the tab bar.
useStore.subscribe((s, prev) => {
  if (s.live === prev.live) return
  const waiting = Object.values(s.live).filter((l) => l.status === 'needs' && !l.paused).length
  document.title = waiting ? `(${waiting}) vibeboard` : 'vibeboard'
})

// Edits from the last 400ms before a reload. Best effort: keepalive bodies are capped at 64KB.
addEventListener('pagehide', () => {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot()), keepalive: true }).catch(() => {})
})

export const agentColor = (id: string) => agentById(id)?.color ?? '#9a948c'
