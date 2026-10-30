import { Code2, MessageSquare, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react'
import type { AppUpdateState, Mode } from '../../../shared/types'
import { bridge } from '../bridge'
import { Mark } from './Brand'
import { UpdateButton } from './UpdateButton'

interface Props {
  sidebar: boolean
  onToggleSidebar(): void
  mode: Mode
  onMode(mode: Mode): void
  update: AppUpdateState
  busy: boolean
  beforeRestart(): Promise<void>
  notify(message: string): void
}

export function Titlebar(props: Props) {
  return <div className={`titlebar ${props.sidebar ? 'has-sidebar' : ''}`}>
    <div className="titlebar-start"><button className="icon-button" aria-label={props.sidebar ? 'Seitenleiste ausblenden' : 'Seitenleiste anzeigen'} onClick={props.onToggleSidebar}>{props.sidebar ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}</button><span className="titlebar-brand"><Mark size={18}/><span>Koda</span></span></div>
    <div className="workspace-switch" role="group" aria-label="Arbeitsbereich"><button aria-label="Chat-Modus" aria-pressed={props.mode === 'chat'} className={props.mode === 'chat' ? 'selected' : ''} onClick={() => props.onMode('chat')}><MessageSquare size={15}/><span>Chat</span></button><button aria-label="Code-Modus" aria-pressed={props.mode !== 'chat'} className={props.mode !== 'chat' ? 'selected' : ''} onClick={() => props.onMode('code')}><Code2 size={16}/><span>Code</span></button></div>
    <div className="window-controls">{!bridge.desktop && <span className="preview-label">Vorschau</span>}<UpdateButton state={props.update} busy={props.busy} beforeRestart={props.beforeRestart} notify={props.notify}/><button aria-label="Fenster minimieren" onClick={() => bridge.windowAction('minimize')}><Minus size={14}/></button><button aria-label="Fenster maximieren" onClick={() => bridge.windowAction('maximize')}><Square size={11}/></button><button aria-label="Fenster schließen" onClick={() => bridge.windowAction('close')}><X size={16}/></button></div>
  </div>
}
