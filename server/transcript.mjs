// Reads a Claude Code transcript (.jsonl). Returns the conversation as plain lines, and the agent's
// final reply word for word: the text it wrote after its last tool call, which is usually the
// deliverable (a plan, a list of findings) and must not be lost in a summary.
export function readTranscript(jsonl) {
  const lines = []
  let last = []
  for (const raw of jsonl.split('\n')) {
    let e
    try {
      e = JSON.parse(raw)
    } catch {
      continue
    }
    if (e.type !== 'user' && e.type !== 'assistant') continue
    const content = typeof e.message?.content === 'string' ? [{ type: 'text', text: e.message.content }] : e.message?.content || []
    if (e.type === 'user') last = [] // a new prompt or a tool result: whatever came before was not the final word
    for (const c of content) {
      if (c.type === 'text' && c.text?.trim()) {
        lines.push(`${e.type === 'user' ? 'User' : 'Agent'}: ${c.text.trim()}`)
        if (e.type === 'assistant') last.push(c.text.trim())
      } else if (c.type === 'tool_use') {
        lines.push(`[${c.name} ${JSON.stringify(c.input).slice(0, 160)}]`)
        last = []
      }
    }
  }
  return { lines, lastReply: last.join('\n\n') }
}
