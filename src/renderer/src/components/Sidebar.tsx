import { ChevronDown, Folder, FolderOpen, KeyRound, LoaderCircle, MessageSquare, Plus, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import type { Conversation, Project } from '../../../shared/types'

interface Props {
  view: 'workspace' | 'projects' | 'history'
  projects: Project[]
  conversations: Conversation[]
  selectedId: string | null
  selectedProject?: Project
  activeConversationId?: string
  connected: number
  onNew(projectId?: string): void
  onSelect(chat: Conversation): void
  onView(view: 'projects' | 'history'): void
  onOpenProject(): void
  onProject(project: Project): void
  onSettings(): void
  onCustomize(): void
}

export function Sidebar(props: Props) {
  const recent = [...props.conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 14)
  return <aside className="sidebar">
    <button className="new-chat-button" onClick={() => props.onNew()}><Plus size={18}/><span>Neuer Chat</span><kbd>Ctrl N</kbd></button>
    <nav className="main-nav" aria-label="Hauptnavigation">
      <button className={props.view === 'history' ? 'active' : ''} onClick={() => props.onView('history')}><Search size={17}/><span>Suchen</span><kbd>Ctrl K</kbd></button>
      <button className={props.view === 'projects' ? 'active' : ''} onClick={() => props.onView('projects')}><Folder size={17}/><span>Projekte</span></button>
      <button onClick={props.onCustomize}><SlidersHorizontal size={17}/><span>Anpassungen</span></button>
    </nav>
    {props.projects.length > 0 && <div className="sidebar-projects"><div className="sidebar-section-title"><span>Projekte</span><button className="icon-button" title="Projektordner hinzufügen" onClick={props.onOpenProject}><Plus size={14}/></button></div>{props.projects.slice(0, 5).map(project => <button key={project.id} className={`project-item ${props.selectedProject?.id === project.id ? 'selected' : ''}`} title={project.path} onClick={() => props.onProject(project)}><Folder size={14}/><span>{project.name}</span></button>)}</div>}
    <div className="sidebar-chats"><div className="sidebar-section-title"><span>Letzte Chats</span><ChevronDown size={11}/></div>{recent.map(chat => <button key={chat.id} className={`recent-chat ${props.selectedId === chat.id && props.view === 'workspace' ? 'selected' : ''}`} onClick={() => props.onSelect(chat)} title={chat.title}><span>{chat.title}</span>{props.activeConversationId === chat.id && <LoaderCircle size={12} className="spin"/>}</button>)}{!recent.length && <div className="empty-recent"><MessageSquare size={17}/><p>Noch keine Chats.</p></div>}{props.conversations.length > 14 && <button className="all-chats" onClick={() => props.onView('history')}>Alle Chats anzeigen</button>}</div>
    <div className="sidebar-bottom">
      {!props.projects.length && <button className="open-project-tile" onClick={props.onOpenProject}><FolderOpen size={16}/><span>Projekt öffnen</span><Plus size={13}/></button>}
      <button className="sidebar-connection" onClick={props.onSettings}><KeyRound size={14}/><span>{props.connected ? `${props.connected} Anbieter verbunden` : 'API-Key verbinden'}</span>{props.connected > 0 && <span className="connected-dot"/>}</button>
      <button className="sidebar-settings user-row" onClick={props.onSettings} aria-label="Einstellungen"><span className="avatar">K</span><span>Koda<small>Dein Workspace</small></span><span className="version">v{__APP_VERSION__}</span><Settings2 size={15}/></button>
    </div>
  </aside>
}
