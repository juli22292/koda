import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Code2, Folder, MessageSquare, Paperclip, Plus, Settings2, ShieldCheck, Square, X } from 'lucide-react'
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
export function Composer(props: Props) {
  const { draft, onDraft, project, mode, onMode, provider, model, settings, busy } = props
  const [modelMenu, setModelMenu] = useState(false)
  const [modeMenu, setModeMenu] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [props.focusKey])
  useEffect(() => { if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = `${Math.min(ref.current.scrollHeight, 220)}px` } }, [draft])
  useEffect(() => {
    const listener = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) { setModelMenu(false); setModeMenu(false) } }
    const keyboard = (e: KeyboardEvent) => { if (e.key === 'Escape') { setModelMenu(false); setModeMenu(false) } }
    document.addEventListener('mousedown', listener); document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('mousedown', listener); document.removeEventListener('keydown', keyboard) }
  }, [])
  const connected = isConfigured(settings.providers.find(p => p.id === provider)!)
  return <div className={`composer ${props.compact ? 'compact' : ''}`} ref={root}>
    {(props.attachments.length > 0) && <div className="attachment-list">{props.attachments.map((file, index) => <span className="attachment-chip" key={`${file.name}-${index}`}><Paperclip size={12}/>{file.name}<button title={`${file.name} entfernen`} onClick={() => props.onRemoveAttachment(index)}><X size={12}/></button></span>)}</div>}
    <textarea ref={ref} aria-label="Nachricht an Koda" placeholder={mode === 'code' ? 'Beschreibe, was du bauen oder ändern möchtest …' : 'Was möchtest du über deinen Code wissen?'} value={draft} onChange={e => onDraft(e.target.value)} rows={props.compact ? 2 : 3} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim() && !busy) props.onSend() } }} />
    <div className="composer-toolbar"><div className="composer-tools"><button className="icon-button attachment-button" title="Textdateien anhängen" aria-label="Dateien anhängen" onClick={props.onAttach}><Plus size={19}/></button><span className="toolbar-divider"/><div className="menu-anchor"><button className={`mode-button ${modeMenu ? 'open' : ''}`} onClick={() => { setModeMenu(!modeMenu); setModelMenu(false) }} aria-expanded={modeMenu}>{mode === 'code' ? <Code2 size={15}/> : <MessageSquare size={14}/>}<span>{mode === 'code' ? 'Code' : 'Fragen'}</span><ChevronDown size={12}/></button>{modeMenu && <div className="dropdown mode-menu"><span className="dropdown-label">ARBEITSWEISE</span>{([{ id: 'code', title: 'Code', description: 'Dateien bearbeiten und Befehle ausführen', icon: Code2 }, { id: 'ask', title: 'Fragen', description: 'Code lesen, verstehen und besprechen', icon: MessageSquare }] as const).map(item => <button key={item.id} className={mode === item.id ? 'selected' : ''} onClick={() => { onMode(item.id); setModeMenu(false) }}><item.icon size={17}/><span><strong>{item.title}</strong><small>{item.description}</small></span>{mode === item.id && <Check size={14}/>}</button>)}</div>}</div><button className="composer-project" onClick={props.onProject} title={project?.path || 'Projektordner auswählen'}><Folder size={13}/><span>{project?.name || 'Projekt wählen'}</span></button></div>
      <div className="composer-right"><div className="menu-anchor model-anchor"><button className="model-button" onClick={() => { setModelMenu(!modelMenu); setModeMenu(false); setQuery('') }} aria-expanded={modelMenu}><span className={`model-state ${connected ? 'ready' : ''}`}/><span>{connected ? modelLabel(model) : 'Modell wählen'}</span><ChevronDown size={12}/></button>{modelMenu && <div className="dropdown model-menu"><div className="model-menu-heading"><span>Modell auswählen</span><button className="icon-button" title="Modelle verwalten" onClick={() => { setModelMenu(false); props.onSettings() }}><Settings2 size={14}/></button></div><input autoFocus className="model-search" placeholder="Modell suchen …" aria-label="Modelle suchen" value={query} onChange={e => setQuery(e.target.value)}/><div className="model-menu-list">{PROVIDERS.map(p => {
        const config = settings.providers.find(c => c.id === p.id)!
        const available = isConfigured(config)
        const models = Array.from(new Set([config.model, ...config.models])).filter(m => m && (!query || `${p.name} ${m}`.toLowerCase().includes(query.toLowerCase())))
        if (available && models.length === 0) return null
        if (!available && query && !p.name.toLowerCase().includes(query.toLowerCase())) return null
        return <div className="model-group" key={p.id}><span className="model-group-label"><ProviderIcon id={p.id} size={19}/>{p.name}{!available && <small>API-Key fehlt</small>}</span>{available ? models.slice(0, query ? 100 : 20).map(m => <button key={m} className={provider === p.id && model === m ? 'selected' : ''} onClick={() => { props.onSelectModel(p.id, m); setModelMenu(false) }}><span>{modelLabel(m)}</span>{provider === p.id && model === m && <Check size={13}/>}</button>) : <button className="connect-provider" onClick={() => { setModelMenu(false); props.onSettings(p.id) }}>Verbinden <span>+</span></button>}</div>
      })}</div><button className="model-menu-footer" onClick={() => { setModelMenu(false); props.onSettings() }}><Plus size={13}/> Anbieter verwalten</button></div>}</div><button className={`send-button ${busy ? 'stop' : ''}`} aria-label={busy ? 'Antwort stoppen' : 'Nachricht senden'} title={busy ? 'Antwort stoppen' : 'Senden · Enter'} disabled={!busy && !draft.trim()} onClick={busy ? props.onStop : props.onSend}>{busy ? <Square size={14} fill="currentColor"/> : <ArrowUp size={19}/>}</button></div></div>
    <div className="composer-under"><span><ShieldCheck size={12}/>{mode === 'code' ? 'Änderungen werden von dir bestätigt' : 'Lesezugriff auf dein Projekt'}</span><span><kbd>↵</kbd> senden <i>·</i><kbd>⇧ ↵</kbd> neue Zeile</span></div>
  </div>
}
