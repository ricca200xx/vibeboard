import { memo, useEffect, useRef, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { ArrowRight, ExternalLink, Globe, LayoutList, Plus, RotateCw, Users, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, workspace, type GroupData, type InkData, type KanbanData, type NoteData, type TextData, type WebData } from '../store'

export const NOTE_COLORS = ['#f7d774', '#f4a7c1', '#a8e6a1', '#9cc9f5', '#f8b88b']

function GroupNodeImpl({ id, data, selected }: NodeProps<Node<GroupData>>) {
  const members = useStore(useShallow((s) => workspace(s)?.nodes.filter((n) => n.parentId === id).map((n) => n.id) ?? []))
  const working = useStore((s) => members.filter((m) => s.live[m]?.status === 'working').length)
  const [editing, setEditing] = useState(false)
  const updateData = useStore((s) => s.updateData)
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={140} />
      <div className="group-node" style={{ ['--g' as string]: data.color }}>
        <div className="group-head" onDoubleClick={() => setEditing(true)}>
          <Users size={13} color={data.color} />
          {editing ? (
            <input
              className="nodrag"
              autoFocus
              defaultValue={data.label}
              onBlur={(e) => {
                updateData(id, { label: e.target.value.trim() || data.label })
                setEditing(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            data.label
          )}
          <span className="meta">
            {members.length} · {working ? `${working} running` : 'idle'}
          </span>
          <button className="icon-btn sm nodrag ungroup" title="Ungroup (consoles stay)" onClick={() => useStore.getState().ungroup(id)}>
            <X size={13} />
          </button>
        </div>
        {!members.length && <div className="group-empty">Drag consoles here</div>}
      </div>
    </>
  )
}
export const GroupNode = memo(GroupNodeImpl)

// React Flow focuses a freshly selected node after mount; take the focus back on the next tick.
function useFocusWhenNew(ref: React.RefObject<HTMLTextAreaElement | null>, isNew: boolean) {
  useEffect(() => {
    if (!isNew) return
    const t = setTimeout(() => ref.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])
}

function NoteNodeImpl({ id, data, selected }: NodeProps<Node<NoteData>>) {
  const updateData = useStore((s) => s.updateData)
  const ref = useRef<HTMLTextAreaElement>(null)
  useFocusWhenNew(ref, !data.text)
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={140} minHeight={110} />
      <div className="note-node" style={{ background: data.color }}>
        <textarea ref={ref} className="nodrag nowheel" value={data.text} placeholder="Note…" onChange={(e) => updateData(id, { text: e.target.value })} />
      </div>
    </>
  )
}
export const NoteNode = memo(NoteNodeImpl)

function TextNodeImpl({ id, data }: NodeProps<Node<TextData>>) {
  const updateData = useStore((s) => s.updateData)
  const [editing, setEditing] = useState(!data.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useFocusWhenNew(ref, !data.text)
  return (
    <div className="text-node" onDoubleClick={() => setEditing(true)}>
      {editing ? (
        <textarea
          ref={ref}
          className="nodrag nowheel"
          autoFocus
          rows={Math.max(1, data.text.split('\n').length)}
          defaultValue={data.text}
          onBlur={(e) => {
            const text = e.target.value
            if (!text.trim()) useStore.getState().removeNode(id)
            else updateData(id, { text })
            setEditing(false)
          }}
        />
      ) : (
        data.text
      )}
    </div>
  )
}
export const TextNode = memo(TextNodeImpl)

function WebNodeImpl({ id, data, selected }: NodeProps<Node<WebData>>) {
  const updateData = useStore((s) => s.updateData)
  const [url, setUrl] = useState(data.url)
  const [nonce, setNonce] = useState(0)
  const go = () => updateData(id, { url: /^https?:\/\//.test(url) ? url : `http://${url}` })
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={320} minHeight={220} />
      <div className="card-node web-node">
        <div className="web-bar">
          <Globe size={15} color="var(--muted)" />
          <input className="nodrag" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          <button className="icon-btn sm nodrag" title="Reload" onClick={() => setNonce((n) => n + 1)}>
            <RotateCw size={13} />
          </button>
          <a className="icon-btn sm nodrag" title="Open in browser" href={data.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} />
          </a>
          <button className="icon-btn sm nodrag" title="Close" onClick={() => useStore.getState().removeNode(id)}>
            <X size={14} />
          </button>
        </div>
        <iframe key={nonce} className="nodrag nowheel" src={data.url} title={data.url} />
      </div>
    </>
  )
}
export const WebNode = memo(WebNodeImpl)

function KanbanNodeImpl({ id, data, selected }: NodeProps<Node<KanbanData>>) {
  const updateData = useStore((s) => s.updateData)
  const set = (columns: KanbanData['columns']) => updateData(id, { columns })
  const move = (ci: number, ki: number) => {
    const card = data.columns[ci].cards[ki]
    set(
      data.columns.map((c, i) =>
        i === ci ? { ...c, cards: c.cards.filter((_, k) => k !== ki) } : i === (ci + 1) % data.columns.length ? { ...c, cards: [...c.cards, card] } : c,
      ),
    )
  }
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={420} minHeight={240} />
      <div className="card-node">
        <div className="card-head">
          <LayoutList size={16} color="var(--muted)" />
          <span className="t">Kanban</span>
          <span className="spacer" />
          <button className="icon-btn sm nodrag" onClick={() => useStore.getState().removeNode(id)}>
            <X size={14} />
          </button>
        </div>
        <div className="kanban nodrag nowheel">
          {data.columns.map((col, ci) => (
            <div className="col" key={col.title}>
              <div className="section-label">
                {col.title} · {col.cards.length}
              </div>
              {col.cards.map((card, ki) => (
                <div className="card" key={ki}>
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => set(data.columns.map((c, i) => (i === ci ? { ...c, cards: c.cards.map((x, k) => (k === ki ? e.currentTarget.textContent || '' : x)) } : c)))}
                  >
                    {card}
                  </span>
                  <button className="icon-btn sm" title="Move" onClick={() => move(ci, ki)}>
                    <ArrowRight size={12} />
                  </button>
                  <button className="icon-btn sm" title="Delete" onClick={() => set(data.columns.map((c, i) => (i === ci ? { ...c, cards: c.cards.filter((_, k) => k !== ki) } : c)))}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button className="add" onClick={() => set(data.columns.map((c, i) => (i === ci ? { ...c, cards: [...c.cards, 'New card'] } : c)))}>
                <Plus size={12} /> Add card
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
export const KanbanNode = memo(KanbanNodeImpl)

function ImageNodeImpl({ data, selected }: NodeProps<Node<{ src: string }>>) {
  return (
    <>
      <NodeResizer isVisible={selected} keepAspectRatio minWidth={80} minHeight={60} />
      <div className="image-node" style={{ width: '100%', height: '100%' }}>
        <img src={data.src} alt="" draggable={false} />
      </div>
    </>
  )
}
export const ImageNode = memo(ImageNodeImpl)

function InkNodeImpl({ data, width, height }: NodeProps<Node<InkData>>) {
  return (
    <div className="ink-node">
      <svg width={width ?? 10} height={height ?? 10}>
        {data.paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={data.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  )
}
export const InkNode = memo(InkNodeImpl)
