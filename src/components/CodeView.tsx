import { useEffect, useRef } from 'react'
import { basicSetup, minimalSetup } from 'codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'

// The file's extension decides the highlighting and the chip shown next to its name.
const LANGS: Record<string, [string, () => Extension]> = {
  js: ['JS', () => javascript()],
  mjs: ['JS', () => javascript()],
  cjs: ['JS', () => javascript()],
  jsx: ['JSX', () => javascript({ jsx: true })],
  ts: ['TS', () => javascript({ typescript: true })],
  mts: ['TS', () => javascript({ typescript: true })],
  tsx: ['TSX', () => javascript({ typescript: true, jsx: true })],
  json: ['JSON', () => json()],
  css: ['CSS', () => css()],
  html: ['HTML', () => html()],
  svg: ['SVG', () => html()],
  md: ['Markdown', () => markdown()],
  mdx: ['MDX', () => markdown()],
  py: ['Python', () => python()],
}
const ext = (path: string) => path.split('.').pop()?.toLowerCase() ?? ''
export const langLabel = (path: string) => LANGS[ext(path)]?.[0] ?? (ext(path) ? ext(path).toUpperCase() : 'Text')

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: '#d8d3cb', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#5f5a54', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a39d94' },
    '.cm-cursor': { borderLeftColor: '#f0553a' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(240,85,58,0.25) !important' },
    '.cm-foldGutter span': { color: '#5f5a54' },
    '&.cm-focused': { outline: 'none' },
    '.cm-panels': { backgroundColor: '#201e1b', color: '#d8d3cb' },
    '.cm-searchMatch': { backgroundColor: 'rgba(240,164,58,0.3)' },
  },
  { dark: true },
)

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#ff7a6b' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#f2b36f' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#79b8ff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#7ee787' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d2a8ff' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6a737d', fontStyle: 'italic' },
  { tag: [t.tagName, t.angleBracket], color: '#7ee787' },
  { tag: t.attributeName, color: '#79b8ff' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#e1ddd6' },
  { tag: t.heading, color: '#ff8a5c', fontWeight: '700' },
  { tag: [t.link, t.url], color: '#79b8ff', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.meta, color: '#a39d94' },
])

// One CodeMirror editor. Read-only for code cards; editable (with ⌘S) in the Code studio.
export function CodeView({ text, path, readOnly, onChange, onSave }: { text: string; path: string; readOnly?: boolean; onChange?: (text: string) => void; onSave?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const handlers = useRef({ onChange, onSave })
  handlers.current = { onChange, onSave }

  useEffect(() => {
    const lang = LANGS[ext(path)]?.[1]()
    const state = EditorState.create({
      doc: text,
      extensions: [
        readOnly ? [minimalSetup, lineNumbers(), EditorState.readOnly.of(true), EditorView.editable.of(false)] : basicSetup,
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (handlers.current.onSave?.(), true) }]),
        EditorView.updateListener.of((u) => u.docChanged && handlers.current.onChange?.(u.state.doc.toString())),
        theme,
        syntaxHighlighting(highlight),
        lang ?? [],
      ],
    })
    view.current = new EditorView({ state, parent: host.current! })
    return () => view.current?.destroy()
  }, [path, readOnly])

  // New text from outside (a reload) replaces the document; typing does not round-trip here.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
  }, [text])

  return <div ref={host} className="code-view nodrag nowheel" />
}
