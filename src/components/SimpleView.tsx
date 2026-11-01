import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Square, TerminalSquare, X } from 'lucide-react'
import { api, type Ask, type ConversationItem } from '../api'
import { renderMarkdown } from '../markdown'
import { useStore, type ConsoleData } from '../store'
import { statusLine } from '../../shared/plain.js'
import { isRefusal } from '../../shared/prompts.js'
import type { ConsoleStatus } from './ConsoleNode'

const NOT_STARTED_MS = 8000
const EMPTY: ConversationItem[] = []

// The sentence under the console's title: what it is doing, in plain words.
export function StatusStrip({ id, status }: { id: string; status: ConsoleStatus }) {
  const activity = useStore((s) => s.live[id]?.activity)
  return (
    <div className={`simple-status ${status}`}>
      <span className="dot" />
      <span className="t">{statusLine(status, activity ?? undefined)}</span>
    </div>
  )
}

function Agent({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="simple-msg agent paper dark" dangerouslySetInnerHTML={{ __html: html }} />
}

// Runs of tool steps fold together, so a long job does not bury what the agent said.
function Steps({ steps, open }: { steps: ConversationItem[]; open: boolean }) {
  const list = (
    <ul>
      {steps.map((s, i) => (
        <li key={i} className={s.failed ? 'failed' : ''}>
          {s.failed ? <X size={12} /> : s.pending ? <span className="dot" /> : <Check size={12} />} {s.text}
        </li>
      ))}
    </ul>
  )
  if (steps.length < 4) return <div className="simple-steps">{list}</div>
  return (
    <details className="simple-steps" open={open}>
      <summary>{steps.length} steps</summary>
      {list}
    </details>
  )
}

function grouped(items: ConversationItem[]) {
  const out: ({ kind: 'steps'; steps: ConversationItem[] } | ConversationItem)[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (it.kind === 'step' && last?.kind === 'steps') last.steps.push(it)
    else out.push(it.kind === 'step' ? { kind: 'steps', steps: [it] } : it)
  }
  return out
}

// Claude's conversation, read from its own transcript, laid over the terminal running underneath.
export function Conversation({ id, name }: { id: string; name: string }) {
  const tick = useStore((s) => s.live[id]?.tick ?? 0)
  const alive = useStore((s) => !!s.live[id])
  const [items, setItems] = useState<ConversationItem[]>(EMPTY)
  const pending = useStore((s) => s.pendingPrompt[id])
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    if (!alive) return // what was already read stays on screen after the agent exits
    let gone = false
    api
      .conversation(id)
      .then((r) => !gone && setItems(r.items))
      .catch((e) => console.error('could not read the conversation', e))
    return () => {
      gone = true
    }
  }, [id, tick, alive])

  // Follows the newest line, unless the person has scrolled up to read.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items, pending])

  const rows = grouped(items)
  const waiting = pending && !items.some((i) => i.kind === 'user' && i.text === pending)
  return (
    <div
      ref={ref}
      className="simple-log nodrag nowheel nopan"
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {!rows.length && !waiting && <p className="simple-empty">Tell {name} what to do, in your own words. It works in this folder and tells you what it did.</p>}
      {rows.map((r, i) =>
        r.kind === 'steps' ? (
          <Steps key={i} steps={r.steps} open={i === rows.length - 1} />
        ) : r.kind === 'agent' ? (
          <Agent key={i} text={r.text} />
        ) : r.kind === 'note' ? (
          <p key={i} className="simple-note">
            {r.text}
          </p>
        ) : (
          <div key={i} className="simple-msg user">
            {r.text}
          </div>
        ),
      )}
      {waiting && <div className="simple-msg user sending">{pending}</div>}
    </div>
  )
}

function AskCard({ id, name, ask }: { id: string; name: string; ask: Ask }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => setBusy(false), [ask.id])
  const answer = async (index: number) => {
    setBusy(true)
    try {
      await api.choose(id, ask.id, index)
    } catch {
      useStore.getState().notify('The question changed before your answer arrived. Look again.')
      setBusy(false)
    }
  }
  // "Do you want to proceed?" stays in view even when what it refers to needs scrolling.
  const lines = ask.question.split('\n')
  const heading = lines[lines.length - 1].endsWith('?') ? lines[lines.length - 1] : `${name} is asking`
  const detail = heading === lines[lines.length - 1] ? lines.slice(0, -1).join('\n') : ask.question
  return (
    <div className="ask-card nodrag nowheel" role="alertdialog" aria-label={`${name} is asking`}>
      <b>{heading}</b>
      {detail && <pre>{detail}</pre>}
      <div className="ask-options">
        {ask.options.map((o, i) => (
          <button key={i} className={`btn ${i === ask.selected && !isRefusal(o.label) ? 'primary' : ''}`} disabled={busy} title={o.hint || undefined} onClick={() => answer(i)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TerminalNote({ id, text }: { id: string; text: string }) {
  return (
    <div className="ask-card note nodrag">
      <span>{text}</span>
      <button className="btn" onClick={() => useStore.getState().updateData(id, { view: 'terminal' })}>
        <TerminalSquare size={14} /> Show terminal
      </button>
    </div>
  )
}

// Everything under the terminal: the question being asked, and the box to write in.
export function SimpleFooter({ id, data, status }: { id: string; data: ConsoleData; status: ConsoleStatus }) {
  const ask = useStore((s) => s.live[id]?.ask)
  const started = useStore((s) => s.live[id]?.started)
  const [text, setText] = useState('')
  const [late, setLate] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const claude = data.agent === 'claude'
  // Before its session starts, Enter would answer whatever the CLI is showing (it can mean "No, exit").
  const locked = !!ask || (claude && !started)

  useEffect(() => {
    if (!claude || started) return setLate(false)
    const t = setTimeout(() => setLate(true), NOT_STARTED_MS)
    return () => clearTimeout(t)
  }, [claude, started, data.epoch])

  const send = () => {
    const prompt = text.trim()
    if (!prompt || locked) return
    useStore.setState((s) => ({ pendingPrompt: { ...s.pendingPrompt, [id]: prompt } }))
    api.prompt(id, prompt).catch((e) => useStore.getState().notify(`Could not send it: ${(e as Error).message}`))
    setText('')
  }

  return (
    <div className="simple-footer">
      {ask ? (
        <AskCard id={id} name={data.name} ask={ask} />
      ) : status === 'needs' ? (
        <TerminalNote id={id} text={`${data.name} is asking something that only shows in the terminal.`} />
      ) : (
        late && status !== 'stopped' && <TerminalNote id={id} text={`${data.name} has not started yet. It may need you to sign in.`} />
      )}
      <form
        className="simple-compose nodrag"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          ref={box}
          rows={1}
          value={text}
          disabled={locked}
          placeholder={ask ? 'Answer the question above first' : locked ? 'Starting…' : `Tell ${data.name} what to do…`}
          onChange={(e) => {
            setText(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 110)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
              if (box.current) box.current.style.height = 'auto'
            }
          }}
        />
        {status === 'working' && (
          <button type="button" className="round-btn" title="Stop what it is doing" onClick={() => api.stop(id)}>
            <Square size={13} fill="currentColor" />
          </button>
        )}
        <button className="round-btn go" title="Send" disabled={!text.trim() || locked}>
          <ArrowUp size={15} />
        </button>
      </form>
    </div>
  )
}
