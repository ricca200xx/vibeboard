import { CircleUserRound, Settings, X } from 'lucide-react'
import { askNotifyPermission, useStore } from '../store'
import { AGENTS } from '../../shared/agents.js'
import { AgentIcon } from './icons'

export function SettingsModal() {
  const settings = useStore((s) => s.settings)
  const installed = useStore((s) => s.installed)
  const s = useStore.getState()
  const close = () => s.set({ modal: null })
  const patch = (p: Partial<typeof settings>) => s.set({ settings: { ...settings, ...p } })
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow" style={{ width: 'min(620px, calc(100vw - 120px))' }}>
        <div className="modal-head">
          <span className="ico">
            <Settings size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Settings</h2>
            <div className="sub">Stored on your disk in ~/.vibeboard</div>
          </div>
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="loops">
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="section-label">Default agent</div>
            <div className="pills">
              {AGENTS.filter((a) => installed.includes(a.id)).map((a) => (
                <button key={a.id} className={settings.defaultAgent === a.id ? 'on' : ''} onClick={() => patch({ defaultAgent: a.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <AgentIcon id={a.id} size={22} /> {a.name}
                </button>
              ))}
            </div>
          </div>
          <div className="toggle-row">
            <button className={`toggle ${settings.yolo ? 'on' : ''}`} onClick={() => patch({ yolo: !settings.yolo })} />
            <span>
              New consoles skip permission prompts (YOLO)
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Claude runs with --dangerously-skip-permissions. Only on repos you trust.</div>
            </span>
          </div>
          <div className="toggle-row">
            <button
              className={`toggle ${settings.notify !== false ? 'on' : ''}`}
              onClick={() => {
                if (settings.notify === false) askNotifyPermission()
                patch({ notify: settings.notify === false })
              }}
            />
            <span>
              Notify me when an agent needs me or finishes
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Only while you are in another window. Click the notification to jump to the console.</div>
            </span>
          </div>
          <div className="toggle-row">
            <button className={`toggle ${settings.speak !== false ? 'on' : ''}`} onClick={() => patch({ speak: settings.speak === false })} />
            <span>
              Speak planner replies after a voice command
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Uses the system voice. Note: browser dictation may send audio to its vendor.</div>
            </span>
          </div>
          <div className="toggle-row">
            <CircleUserRound size={20} color="var(--muted)" style={{ margin: '0 12px' }} />
            <span style={{ flex: 1 }}>
              Accounts
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                {settings.profiles?.length ? `${settings.profiles.length} extra sign-in${settings.profiles.length > 1 ? 's' : ''}` : 'Run a second sign-in of Claude or Codex side by side'}
              </div>
            </span>
            <button className="btn" onClick={() => s.set({ modal: 'usage', usageView: 'accounts' })}>
              Manage
            </button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="section-label">Terminal font size</div>
            <div className="pills">
              {[11, 12, 13, 14, 15, 16].map((n) => (
                <button key={n} className={settings.fontSize === n ? 'on' : ''} onClick={() => patch({ fontSize: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
