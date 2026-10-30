import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Code2, Folder, MessageSquare, Paperclip, Plus, Settings2, Square, X } from 'lucide-react'
import type { Attachment, Mode, Project, ProviderId, Settings } from '../../../shared/types'
import { isConfigured, modelLabel, PROVIDERS } from '../../../shared/providers'
import { ProviderIcon } from './Brand'

interface Props {
  draft: string; onDraft(value: string): void; attachments: Attachment[]; onRemoveAttachment(index: number): void
  onAttach(): void; project?: Project; onProject(): void; mode: Mode; onMode(mode: Mode): void
  provider: ProviderId; model: string; settings: Settings
  onSelectModel(provider: ProviderId, model: string): void; onSettings(provider?: ProviderId): void
  onSend(): void; onStop(): void; busy: boolean; compact?: boolean; focusKey: number
}

const modes = [
  { id: 'chat', title: 'Chat', description: 'Fragen, schreiben und Ideen entwickeln', icon: MessageSquare },
  { id: 'code', title: 'Code', description: 'Dateien bearbeiten und Befehle ausführen', icon: Code2 },
  { id: 'ask', title: 'Fragen', description: 'Dein Projekt lesen und verstehen', icon: Folder },
] as const

export function Composer(props: Props) {
  const { draft, onDraft, project, mode, onMode, provider, model, settings, busy } = props
  const [modelMenu, setModelMenu] = useState(false)
  const [modeMenu, setModeMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [menuMaxHeight, setMenuMaxHeight] = useState(500)
  const modelAnchor = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!modelMenu) return
    const resize = () => setMenuMaxHeight(Math.max(160, (modelAnchor.current?.getBoundingClientRect().top ?? 520) - 20))
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [modelMenu])
  useEffect(() => { ref.current?.focus() }, [props.focusKey])
  useEffect(() => {
    if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = `${Math.min(ref.current.scrollHeight, 220)}px` }
  }, [draft])
  useEffect(() => {
    const listener = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) { setModelMenu(false); setModeMenu(false) } }
    const keyboard = (e: KeyboardEvent) => { if (e.key === 'Escape') { setModelMenu(false); setModeMenu(false) } }
    document.addEventListener('mousedown', listener); document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('mousedown', listener); document.removeEventListener('keydown', keyboard) }
  }, [])
  const connected = isConfigured(settings.providers.find(p => p.id === provider)!)
  const selectedMode = modes.find(item => item.id === mode)!
  return <div className={`composer-shell ${props.compact ? 'compact' : ''}`} ref={root}>
    <div className="composer">
      {props.attachments.length > 0 && <div className="attachment-list">{props.attachments.map((file, index) => <span className="attachment-chip" key={`${file.name}-${index}`}><Paperclip size={12}/>{file.name}<button title={`${file.name} entfernen`} onClick={() => props.onRemoveAttachment(index)}><X size={12}/></button></span>)}</div>}
      <textarea ref={ref} aria-label="Nachricht an Koda" placeholder={mode === 'chat' ? 'Wie kann ich dir helfen?' : mode === 'code' ? 'Was möchtest du bauen?' : 'Was möchtest du über dein Projekt wissen?'} value={draft} onChange={e => onDraft(e.target.value)} rows={2} onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim() && !busy) props.onSend() }
      }}/>
      <div className="composer-toolbar"><button className="icon-button attachment-button" title="Textdateien anhängen" aria-label="Dateien anhängen" onClick={props.onAttach}><Plus size={20}/></button><button className={`send-button ${busy ? 'stop' : ''}`} aria-label={busy ? 'Antwort stoppen' : 'Nachricht senden'} title={busy ? 'Antwort stoppen' : 'Nachricht senden'} disabled={!busy && !draft.trim()} onClick={busy ? props.onStop : props.onSend}>{busy ? <Square size={13} fill="currentColor"/> : <ArrowUp size={19}/>}</button></div>
    </div>
    <div className="composer-controls">
      <div className="composer-tools">
        <button className="composer-project" onClick={props.onProject} title={project?.path || 'Projektordner auswählen'}><Folder size={14}/><span>{project?.name || 'Projekt'}</span><ChevronDown size={11}/></button>
        <div className="menu-anchor"><button className={`mode-button ${modeMenu ? 'open' : ''}`} onClick={() => { setModeMenu(!modeMenu); setModelMenu(false) }} aria-expanded={modeMenu}><selectedMode.icon size={14}/><span>{selectedMode.title}</span><ChevronDown size={11}/></button>{modeMenu && <div className="dropdown mode-menu"><span className="dropdown-label">ARBEITSWEISE</span>{modes.map(item => <button key={item.id} className={mode === item.id ? 'selected' : ''} onClick={() => { onMode(item.id); setModeMenu(false) }}><item.icon size={17}/><span><strong>{item.title}</strong><small>{item.description}</small></span>{mode === item.id && <Check size={14}/>}</button>)}</div>}</div>
      </div>
      <div className="menu-anchor model-anchor" ref={modelAnchor}>
        <button className="model-button" onClick={() => { setModelMenu(!modelMenu); setModeMenu(false); setQuery('') }} aria-expanded={modelMenu}><span className={`model-state ${connected ? 'ready' : ''}`}/><span>{connected ? modelLabel(model) : 'Modell wählen'}</span><ChevronDown size={12}/></button>
        {modelMenu && <div className="dropdown model-menu" style={{ maxHeight: menuMaxHeight }}><div className="model-menu-heading"><span>Modell auswählen</span><button className="icon-button" title="Modelle verwalten" onClick={() => { setModelMenu(false); props.onSettings() }}><Settings2 size={14}/></button></div><input autoFocus className="model-search" placeholder="Modell suchen …" aria-label="Modelle suchen" value={query} onChange={e => setQuery(e.target.value)}/><div className="model-menu-list">{PROVIDERS.map(p => {
          const config = settings.providers.find(c => c.id === p.id)!
          const available = isConfigured(config)
          const models = Array.from(new Set([config.model, ...config.models])).filter(m => m && (!query || `${p.name} ${m}`.toLowerCase().includes(query.toLowerCase())))
          if (available && models.length === 0) return null
          if (!available && query && !p.name.toLowerCase().includes(query.toLowerCase())) return null
          return <div className="model-group" key={p.id}><span className="model-group-label"><ProviderIcon id={p.id} size={19}/>{p.name}{!available && <small>API-Key fehlt</small>}</span>{available ? models.slice(0, query ? 100 : 20).map(m => <button key={m} className={provider === p.id && model === m ? 'selected' : ''} onClick={() => { props.onSelectModel(p.id, m); setModelMenu(false) }}><span>{modelLabel(m)}</span>{provider === p.id && model === m && <Check size={13}/>}</button>) : <button className="connect-provider" onClick={() => { setModelMenu(false); props.onSettings(p.id) }}>Verbinden <span>+</span></button>}</div>
        })}</div><button className="model-menu-footer" onClick={() => { setModelMenu(false); props.onSettings() }}><Plus size={13}/> Anbieter verwalten</button></div>}
      </div>
    </div>
  </div>
}
