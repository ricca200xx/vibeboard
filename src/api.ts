// Thin client for the local server (server/index.mjs).
const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => undefined)
    throw new Error(detail || `${method} ${url} → ${res.status}`)
  }
  return res.json() as Promise<T>
}

export type Subagent = { id: string; type: string; task: string; status: 'running' | 'done'; startedAt: number; endedAt?: number }
export type LiveSession = { id: string; agent: string; status: Status; statusAt?: number; cwd: string; paused: boolean; subagents?: Subagent[] }
export type Status = 'idle' | 'working' | 'needs' | 'done'
export type GitInfo = {
  branch: string
  changes: number
  files: { code: string; path: string; orig?: string; add: number; del: number }[]
  upstream: boolean
  ahead: number
  behind: number
  remote: string | null
  commits: { hash: string; subject: string; author: string; when: string }[]
}
// Tokens per local day as [input, output, cache reads + writes], from one agent's session logs.
export type AgentUsage = { days: Record<string, [number, number, number]>; models: Record<string, number>; sessions: number; longestMs: number; first: string | null }
export type Usage = { claude: AgentUsage; codex: AgentUsage; scannedAt: number }
// What the CLI's own /usage screen shows: limits like "Current session 37% · Resets 1:49am".
export type Limits = { at: number; limits: { title: string; pct: number; resets: string | null }[]; insights: { pct: number; text: string }[] }

// A repo scan in progress or waiting for review. step: 0 launch, 1 read the repo, 2 write facts, 3 wrap up.
export type Fact = { kind: string; title: string; text: string }
export type Scan = { id: string; cwd: string; agent: string; startedAt: number; step: number; facts: Fact[]; status: 'running' | 'done' | 'failed'; error: string | null }

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
  background?: boolean // false: pauses while its consoles are on a workspace tab out of view
  nextAt?: number // next scheduled round
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
  gitAction: (action: 'commit' | 'push' | 'pull' | 'message', cwd: string, message?: string, files?: string[]) =>
    call<{ ok?: boolean; message?: string }>('POST', `/api/git/${action}`, { cwd, message, files }),
  usage: () => call<Usage>('GET', '/api/usage'),
  limits: (profile?: string, fresh?: boolean) => call<Limits>('GET', `/api/usage/limits?profile=${encodeURIComponent(profile ?? '')}${fresh ? '&fresh=1' : ''}`),
  claudeSession: (sid: string) => call<{ exists: boolean }>('GET', `/api/claude-session/${sid}`),
  reveal: (cwd: string) => call('POST', '/api/reveal', { cwd }),
  scan: (cwd: string, agent: string) => call<Scan>('POST', '/api/scan', { cwd, agent }),
  clearScan: (cwd: string) => call('DELETE', `/api/scan?cwd=${encodeURIComponent(cwd)}`),
  plan: (command: string, board: unknown) => call<{ reply: string; actions: import('./planner').PlanAction[] }>('POST', '/api/plan', { command, board }),
  handoff: (body: { from: string; to: string; fromName: string; toName: string; role?: string }) =>
    call<{ ok: boolean; duplicate?: boolean }>('POST', '/api/handoff', body),
  addLoop: (loop: Partial<Loop>) => call<Loop>('POST', '/api/loops', loop),
  updateLoop: (id: string, loop: Partial<Loop>) => call<Loop>('PUT', `/api/loops/${id}`, loop),
  runLoop: (id: string) => call<{ ok: boolean; consoles: number }>('POST', `/api/loops/${id}/run`, {}),
  setLoopActive: (id: string, on: boolean) => call<Loop>('POST', `/api/loops/${id}/active`, { on }),
  removeLoop: (id: string) => call('DELETE', `/api/loops/${id}`),
  visible: (ids: string[]) => call('POST', '/api/visible', { ids }),
}

export const ptyUrl = (params: Record<string, string>) => `${wsBase()}/ws/pty?${new URLSearchParams(params)}`

export type ServerEvent =
  | { type: 'sessions'; sessions: LiveSession[] }
  | { type: 'spawn'; session: LiveSession }
  | { type: 'status'; id: string; status: Status; at?: number }
  | { type: 'exit'; id: string; code: number }
  | { type: 'paused'; id: string; paused: boolean }
  | { type: 'session-id'; id: string; sessionId: string; prompted: boolean }
  | { type: 'loops'; loops: Loop[] }
  | { type: 'scans'; scans: Scan[] }
  | { type: 'subagents'; id: string; subagents: Subagent[] }
  | { type: 'handoff'; from: string; to: string; state: 'summarizing' | 'sent' | 'failed' }
  | { type: 'helper'; parent: string; id: string; name: string; agent: string; role: string; cwd: string; yolo: boolean }

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
