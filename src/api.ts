// Thin client for the local server (server/index.mjs).
const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`)
  return res.json() as Promise<T>
}

export type LiveSession = { id: string; agent: string; status: Status; cwd: string; paused: boolean }
export type Status = 'idle' | 'working' | 'needs' | 'done'
export type GitInfo = { branch: string; changes: number; remote: string | null; commits: { hash: string; subject: string; author: string; when: string }[] }
export type Loop = {
  id: string
  name: string
  instruction: string
  trigger: { type: 'schedule'; everyMs: number } | { type: 'idle' } | { type: 'output'; pattern: string }
  target?: { ids?: string[] }
  scope?: string
  stop: { runs?: number; timeMs?: number; goal?: { type: 'command'; command: string } | { type: 'judge'; text: string } }
  runs: number
  startedAt: number
  active: boolean
  finishedReason?: string
}

export const api = {
  getState: () => call<Record<string, unknown>>('GET', '/api/state'),
  putState: (s: unknown) => call('PUT', '/api/state', s),
  agents: () => call<string[]>('GET', '/api/agents'),
  kill: (id: string) => call('DELETE', `/api/pty/${id}`),
  input: (id: string, data: string) => call('POST', `/api/pty/${id}/input`, { data }),
  prompt: (id: string, prompt: string) => call('POST', `/api/pty/${id}/input`, { prompt }),
  signal: (id: string, signal: 'SIGSTOP' | 'SIGCONT') => call('POST', `/api/pty/${id}/signal`, { signal }),
  tail: (id: string, chars = 8000) => call<{ text: string }>('POST', `/api/pty/${id}/tail`, { chars }),
  ls: (path?: string) =>
    call<{ path: string; parent: string; home: string; dirs: string[]; isRepo: boolean }>('GET', `/api/ls${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  git: (cwd: string) => call<GitInfo | null>('GET', `/api/git?cwd=${encodeURIComponent(cwd)}`),
  usage: () => call<{ days: Record<string, number>; total: number }>('GET', '/api/usage'),
  claudeSession: (sid: string) => call<{ exists: boolean }>('GET', `/api/claude-session/${sid}`),
  reveal: (cwd: string) => call('POST', '/api/reveal', { cwd }),
  scan: (cwd: string) => call<{ kind: string; title: string; text: string }[]>('POST', '/api/scan', { cwd }),
  plan: (command: string, board: unknown) => call<{ reply: string; actions: import('./planner').PlanAction[] }>('POST', '/api/plan', { command, board }),
  addLoop: (loop: Partial<Loop>) => call<Loop>('POST', '/api/loops', loop),
  removeLoop: (id: string) => call('DELETE', `/api/loops/${id}`),
}

export const ptyUrl = (params: Record<string, string>) => `${wsBase()}/ws/pty?${new URLSearchParams(params)}`

export type ServerEvent =
  | { type: 'sessions'; sessions: LiveSession[] }
  | { type: 'spawn'; session: LiveSession }
  | { type: 'status'; id: string; status: Status }
  | { type: 'exit'; id: string; code: number }
  | { type: 'paused'; id: string; paused: boolean }
  | { type: 'session-id'; id: string; sessionId: string; prompted: boolean }
  | { type: 'loops'; loops: Loop[] }

// Reconnects forever: the server restarts under `node --watch` during development.
export function connectEvents(onEvent: (e: ServerEvent) => void) {
  let ws: WebSocket
  const open = () => {
    ws = new WebSocket(`${wsBase()}/ws/events`)
    ws.onmessage = (m) => onEvent(JSON.parse(m.data))
    ws.onclose = () => setTimeout(open, 1000)
  }
  open()
}
