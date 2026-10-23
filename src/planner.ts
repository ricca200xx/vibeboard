// The command bar planner: plain speech in, board actions out (via `claude -p` on the server).
// The action set has no way to stop or delete a console: that stays a confirmed, manual act.
import { api } from './api'
import { consoles, useStore, workspace } from './store'

export type PlanAction =
  | { type: 'send'; to: string[]; text: string }
  | { type: 'spawn'; agent: string; count: number; group?: string }
  | { type: 'group'; names: string[]; label: string }
  | { type: 'frame'; names: string[] }
  | { type: 'pause' }
  | { type: 'resume' }

export async function runPlanner(command: string): Promise<string> {
  const s = useStore.getState()
  const ws = workspace(s)!
  const groups = ws.nodes.filter((n) => n.type === 'group')
  const board = {
    consoles: consoles(ws.nodes).map((n) => ({
      name: n.data.name,
      agent: n.data.agent,
      status: s.live[n.id] ? (s.live[n.id].paused ? 'paused' : s.live[n.id].status) : 'stopped',
      group: groups.find((g) => g.id === n.parentId)?.data.label,
      selected: !!n.selected,
    })),
    groups: groups.map((g) => g.data.label),
    agents: s.installed,
  }
  const plan = await api.plan(command, board)
  const byName = (names: string[]) => {
    const all = consoles(workspace(useStore.getState())!.nodes)
    const ids = new Set<string>()
    for (const raw of names) {
      const name = raw.toLowerCase()
      if (name === 'all') all.forEach((n) => ids.add(n.id))
      const g = groups.find((x) => String(x.data.label).toLowerCase() === name)
      if (g) all.filter((n) => n.parentId === g.id).forEach((n) => ids.add(n.id))
      all.filter((n) => n.data.name.toLowerCase() === name).forEach((n) => ids.add(n.id))
    }
    return [...ids]
  }
  for (const a of plan.actions ?? []) {
    const st = useStore.getState()
    if (a.type === 'send') st.sendTo(byName(a.to), a.text)
    else if (a.type === 'spawn') st.spawnMany(Array(Math.max(1, Math.min(12, a.count || 1))).fill(a.agent), a.group)
    else if (a.type === 'frame') st.frame([...byName(a.names), ...groups.filter((g) => a.names.includes(String(g.data.label))).map((g) => g.id)])
    else if (a.type === 'pause') st.pauseAll()
    else if (a.type === 'resume') st.resumeAll()
    else if (a.type === 'group') {
      const ids = new Set(byName(a.names))
      st.onNodesChange(workspace(st)!.nodes.map((n) => ({ type: 'select', id: n.id, selected: ids.has(n.id) })))
      st.groupSelected(a.label)
    }
  }
  return plan.reply || 'Done'
}
