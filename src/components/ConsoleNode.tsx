import { memo, useEffect, useRef, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ChevronDown, Copy, RotateCcwClock, RotateCw, X } from 'lucide-react'
import { api, ptyUrl } from '../api'
import { absolute, agentColor, launchCache, useStore, workspace, type ConsoleData } from '../store'
import { AGENTS, agentById } from '../../shared/agents.js'
import { AgentGlyph, AgentIcon } from './icons'

const THEME = {
  background: '#151413',
  foreground: '#e6e1da',
  cursor: '#f0553a',
  cursorAccent: '#151413',
  selectionBackground: 'rgba(240, 85, 58, 0.32)',
  black: '#1d1b19',
  red: '#ff6b5b',
  green: '#62d48a',
  yellow: '#f5c560',
  blue: '#6aa2ff',
  magenta: '#c792ea',
  cyan: '#5fd4d4',
  white: '#d9d4cc',
  brightBlack: '#6b655e',
  brightRed: '#ff8a7a',
  brightGreen: '#86e3a6',
  brightYellow: '#ffd98a',
  brightBlue: '#94bcff',
  brightMagenta: '#ddb0f5',
  brightCyan: '#8ce6e6',
  brightWhite: '#ffffff',
}

export type ConsoleStatus = 'idle' | 'working' | 'needs' | 'done' | 'paused'

export function StatusPill({ status }: { status: ConsoleStatus }) {
  const label = { idle: 'Ready', working: 'Working', needs: 'Needs you', done: 'Done', paused: 'Paused' }[status]
  return (
    <span className={`status-pill ${status}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

// Decide once per (console, epoch, process) how to launch: attach, fresh with a new
// session id, or resume. Cached so a quick remount never re-decides with stale data.
function launchParams(id: string, epoch: number): Record<string, string> {
  const key = `${id}:${epoch}`
  const cached = launchCache.get(key)
  if (cached) return cached
  const s = useStore.getState()
  const d = workspace(s)!.nodes.find((n) => n.id === id)!.data as ConsoleData
  let params: Record<string, string> = { agent: d.agent, cwd: d.cwd, yolo: d.yolo ? '1' : '0' }
  if (!s.live[id] && agentById(d.agent)?.resume) {
    if (d.resumeNext && d.lastSessionId) {
      params = { ...params, resume: d.lastSessionId }
      s.updateData(id, { sessionId: d.lastSessionId, resumeNext: false })
    } else {
      const sessionId = crypto.randomUUID()
      params = { ...params, sessionId }
      // A prompted conversation with no live process means the app was restarted: offer to pick it back up.
      s.updateData(id, d.resumable ? { sessionId, lastSessionId: d.resumable, resumeOffer: true } : { sessionId })
    }
  }
  launchCache.set(key, params)
  return params
}

function TerminalView({ id, epoch, onExit }: { id: string; epoch: number; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const fontSize = useStore((s) => s.settings.fontSize)

  useEffect(() => {
    const el = ref.current!
    let disposed = false
    let ws: WebSocket | null = null
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", Menlo, monospace',
      fontSize,
      lineHeight: 1.22,
      cursorBlink: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      theme: THEME,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const refit = () => {
      if (term.element && el.clientWidth > 0) fit.fit()
    }
    // Metrics are measured at open(): the web font must be ready first.
    document.fonts.load(`${fontSize}px "JetBrains Mono Variable"`).finally(() => {
      if (disposed) return
      term.open(el)
      refit()
      ws = new WebSocket(ptyUrl({ id, cols: String(term.cols), rows: String(term.rows), ...launchParams(id, epoch) }))
      ws.onmessage = (e) => term.write(e.data)
      ws.onclose = (e) => e.code === 4000 && !disposed && onExit()
      term.onData((data) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'i', d: data })))
      // "Typing starts fresh": only a real keystroke dismisses the resume offer. onData would not do:
      // it also fires for the terminal's automatic replies to the TUI's capability queries.
      term.onKey(() => {
        const n = workspace(useStore.getState())?.nodes.find((x) => x.id === id)
        if ((n?.data as ConsoleData | undefined)?.resumeOffer) useStore.getState().updateData(id, { resumeOffer: false })
      })
      term.onResize(({ cols, rows }) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'r', cols, rows })))
    })
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    return () => {
      disposed = true
      ro.disconnect()
      ws?.close()
      term.dispose()
    }
  }, [id, epoch, fontSize])

  // ponytail: xterm ignores the board's CSS scale, so mouse selection is offset when zoom != 100%.
  // Keyboard is unaffected; double-click the header to snap the console to 100%.
  return <div ref={ref} style={{ height: '100%' }} />
}

function ResumeOffer({ id, sessionId }: { id: string; sessionId: string }) {
  const [exists, setExists] = useState(false)
  const resumeConsole = useStore((s) => s.resumeConsole)
  const updateData = useStore((s) => s.updateData)
  useEffect(() => {
    api.claudeSession(sessionId).then((r) => (r.exists ? setExists(true) : updateData(id, { resumeOffer: false })))
  }, [sessionId])
  if (!exists) return null
  return (
    <button className="resume-offer nodrag" onClick={() => resumeConsole(id)}>
      <RotateCcwClock size={18} color="var(--accent)" style={{ marginTop: 2 }} />
      <span>
        <div className="t">Resume last conversation?</div>
        <div className="s">Click to pick it back up · typing starts fresh</div>
      </span>
      <span
        className="icon-btn sm close"
        onClick={(e) => {
          e.stopPropagation()
          updateData(id, { resumeOffer: false })
        }}
      >
        <X size={13} />
      </span>
    </button>
  )
}

function ConsoleNodeImpl({ id, data, selected }: NodeProps<Node<ConsoleData>>) {
  const live = useStore((s) => s.live[id])
  const { updateData, restartConsole, duplicateConsole, removeNode } = useStore.getState()
  const [editing, setEditing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [agentMenu, setAgentMenu] = useState(false)
  const [exited, setExited] = useState(false)
  const status: ConsoleStatus = live?.paused ? 'paused' : (live?.status ?? 'idle')
  const color = agentColor(data.agent)

  useEffect(() => setExited(false), [data.epoch])

  const snapTo100 = () => {
    const s = useStore.getState()
    const ws = workspace(s)!
    const n = ws.nodes.find((x) => x.id === id)!
    const pos = absolute(ws.nodes, n)
    s.flow?.setCenter(pos.x + (n.measured?.width ?? 640) / 2, pos.y + (n.measured?.height ?? 420) / 2, { zoom: 1, duration: 400 })
  }

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={380} minHeight={220} />
      <div className={`console ${status}`} style={{ ['--c' as string]: `color-mix(in srgb, ${color} 42%, #2a2724)` }}>
        <div className="console-head" onDoubleClick={snapTo100}>
          <button className="agent-switch nodrag" onClick={() => setAgentMenu((v) => !v)} title={agentById(data.agent)?.name}>
            <AgentGlyph id={data.agent} size={19} />
            <ChevronDown size={12} />
          </button>
          <span className="dot" style={{ background: data.dot }} />
          {editing ? (
            <input
              className="name nodrag"
              autoFocus
              defaultValue={data.name}
              onBlur={(e) => {
                updateData(id, { name: e.target.value.trim() || data.name })
                setEditing(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <span
              className="name"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
            >
              {data.name}
            </span>
          )}
          {data.yolo && (
            <span className="badge" style={{ color: 'var(--accent)' }}>
              yolo
            </span>
          )}
          <span className="spacer" />
          <StatusPill status={status} />
          <button className="icon-btn sm nodrag" title="Restart" onClick={() => restartConsole(id)}>
            <RotateCw size={14} />
          </button>
          <button className="icon-btn sm nodrag" title="Duplicate" onClick={() => duplicateConsole(id)}>
            <Copy size={14} />
          </button>
          <button className="icon-btn sm nodrag" title="Close" onClick={() => setConfirmClose(true)}>
            <X size={15} />
          </button>
        </div>

        {agentMenu && (
          <div className="menu nodrag nowheel" style={{ top: 44, left: 8, width: 260, maxHeight: 320, overflow: 'auto' }}>
            <div className="menu-title">Switch agent</div>
            {AGENTS.map((a) => (
              <button
                key={a.id}
                className="menu-item"
                onClick={() => {
                  setAgentMenu(false)
                  updateData(id, { agent: a.id })
                  restartConsole(id)
                }}
              >
                <AgentIcon id={a.id} size={28} />
                <span className="title" style={{ fontSize: 14 }}>
                  {a.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {confirmClose && (
          <div className="confirm-bar nodrag">
            Stop {data.name} and remove it?
            <button className="btn" onClick={() => setConfirmClose(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => removeNode(id)}>
              Stop
            </button>
          </div>
        )}

        {data.resumeOffer && data.lastSessionId && <ResumeOffer id={id} sessionId={data.lastSessionId} />}

        <div className="console-body nodrag nowheel nopan">
          <TerminalView id={id} epoch={data.epoch} onExit={() => setExited(true)} />
          {exited && (
            <div className="console-overlay">
              <div className="box">
                <div>{agentById(data.agent)?.name ?? 'Process'} exited</div>
                <button className="btn primary" onClick={() => restartConsole(id)}>
                  <RotateCw size={14} /> Relaunch
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export const ConsoleNode = memo(ConsoleNodeImpl)
