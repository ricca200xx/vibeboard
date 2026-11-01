import { useEffect } from 'react'
import { useStore } from './store'
import { Home } from './components/Home'
import { BoardScreen } from './components/BoardScreen'
import { Tips } from './components/Tips'

export function App() {
  const ready = useStore((s) => s.ready)
  const active = useStore((s) => s.active)
  const toast = useStore((s) => s.toast)

  useEffect(() => useStore.getState().init(), [])

  if (!ready) return <div className="home" />
  return (
    <>
      {active ? <BoardScreen key={active} /> : <Home />}
      {toast && <div className="toast">{toast}</div>}
      <Tips />
    </>
  )
}
