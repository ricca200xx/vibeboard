import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import '@xyflow/react/dist/style.css'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// No StrictMode: double-mounted effects would open every PTY socket twice.
createRoot(document.getElementById('root')!).render(<App />)
