import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, Code2, Copy, Download, Ellipsis, FileCode2, Folder, FolderOpen, History, KeyRound, LayoutGrid, LoaderCircle, LockKeyhole, MessageSquare, Minus, PanelLeftClose, PanelLeftOpen, PanelRight, Plus, Search, Settings2, ShieldCheck, Square, Terminal, Trash2, X } from 'lucide-react'
import type { AppData, AppUpdateState, Attachment, ChatEvent, Conversation, Message, Mode, Project, ProviderId, Settings as SettingsType } from '../../shared/types'
import { defaultSettings, isConfigured, modelLabel, providerMeta } from '../../shared/providers'
import { bridge } from './bridge'
import { Mark, ProviderIcon } from './components/Brand'
import { Settings } from './components/Settings'
import { Composer } from './components/Composer'
import { Markdown } from './components/Markdown'
import { FilePanel } from './components/FilePanel'
import { ToolCard } from './components/ToolCard'
import { ChatActivity } from './components/ChatActivity'
import { UpdateButton } from './components/UpdateButton'

type View = 'workspace' | 'projects' | 'history'
type ActiveRun = { requestId: string; conversationId: string; messageId: string }
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '')
const withAttachments = (message: Message) => `${message.content}${message.attachments?.map(f => `\n\n<attached_file name=${JSON.stringify(f.name)}>\n${f.content}\n</attached_file>`).join('') || ''}`

export default function App() {
  const [updateState, setUpdateState] = useState<AppUpdateState>({ status: 'idle', currentVersion: __APP_VERSION__ })
  const [settings, setSettings] = useState<SettingsType>(defaultSettings)
  const [data, setData] = useState<AppData>({ projects: [], conversations: [] })
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<View>('workspace')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | undefined>()
  const [provider, setProvider] = useState<ProviderId>('openai')
  const [model, setModel] = useState(defaultSettings().providers[0].model)
  const [mode, setMode] = useState<Mode>('code')
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [initialProvider, setInitialProvider] = useState<ProviderId | undefined>()
  const [sidebar, setSidebar] = useState(true)
  const [filesOpen, setFilesOpen] = useState(false)
  const [fileRevision, setFileRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [focusKey, setFocusKey] = useState(0)
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)
  const activeRef = useRef<ActiveRun | null>(null)
  const [toast, setToast] = useState('')
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [moreOpen, setMoreOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const stateRef = useRef({ settingsOpen, selectedId }); stateRef.current = { settingsOpen, selectedId }
  const conversation = data.conversations.find(c => c.id === selectedId)
  const selectedProject = data.projects.find(p => p.id === (conversation?.projectId ?? projectId))
  const configured = settings.providers.filter(isConfigured)
  const notify = useCallback((message: string) => { setToast(message); clearTimeout(toastTimeout.current); toastTimeout.current = setTimeout(() => setToast(''), 5000) }, [])
  const openSettings = (id?: ProviderId) => { setInitialProvider(id); setSettingsOpen(true) }
  useEffect(() => {
    const unsubscribe = bridge.onUpdateState(setUpdateState)
    void bridge.getUpdateState().then(setUpdateState).catch(() => {})
    return unsubscribe
  }, [])
  const beforeRestart = async () => {
    if (activeRef.current) throw new Error('Warte auf die laufende Antwort, bevor du Koda neu startest.')
    localStorage.setItem('koda-restart-session', JSON.stringify({ selectedId, projectId, provider, model, mode, draft, attachments, view }))
    await bridge.saveData(data)
  }
  useEffect(() => {
    Promise.all([bridge.getSettings(), bridge.getData()]).then(([settings, data]) => {
      setSettings(settings); setData(data)
      const initial = settings.providers.find(p => p.id === settings.defaultProvider)!
      const selected = isConfigured(initial) ? initial : settings.providers.find(isConfigured) || initial
      setProvider(selected.id); setModel(selected.model)
      try {
        const saved = localStorage.getItem('koda-restart-session')
        if (saved) {
          const session = JSON.parse(saved)
          if (session.selectedId && data.conversations.some(c => c.id === session.selectedId)) setSelectedId(session.selectedId)
          if (session.projectId && data.projects.some(p => p.id === session.projectId)) setProjectId(session.projectId)
          if (settings.providers.some(p => p.id === session.provider)) { setProvider(session.provider); if (typeof session.model === 'string') setModel(session.model) }
          if (session.mode === 'code' || session.mode === 'ask') setMode(session.mode)
          if (typeof session.draft === 'string') setDraft(session.draft)
          if (Array.isArray(session.attachments)) setAttachments(session.attachments)
          if (['workspace', 'projects', 'history'].includes(session.view)) setView(session.view)
          localStorage.removeItem('koda-restart-session')
        }
      } catch { localStorage.removeItem('koda-restart-session') }
      setLoaded(true)
    }).catch(error => setLoadError(errorText(error)))
  }, [])
  useEffect(() => {
    if (!loaded) return
    const timeout = setTimeout(() => void bridge.saveData(data).catch(error => notify(`Speichern fehlgeschlagen: ${errorText(error)}`)), 400)
    return () => clearTimeout(timeout)
  }, [data, loaded, notify])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = settings.theme === 'system' ? media.matches ? 'dark' : 'light' : settings.theme }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
  useEffect(() => bridge.onChatEvent((event: ChatEvent) => {
    const active = activeRef.current
    if (!active || event.requestId !== active.requestId) return
    setData(current => ({ ...current, conversations: current.conversations.map(c => {
      if (c.id !== active.conversationId) return c
      if (event.type === 'done') return { ...c, apiMessages: event.apiMessages, tokens: (c.tokens || 0) + event.tokens, updatedAt: Date.now() }
      return { ...c, updatedAt: Date.now(), apiMessages: undefined, messages: c.messages.map(m => {
        if (m.id !== active.messageId) return m
        if (event.type === 'text') return { ...m, content: m.content + event.text }
        if (event.type === 'tool') return { ...m, tools: [...(m.tools || []).filter(t => t.id !== event.tool.id), event.tool] }
        if (event.type === 'error') return { ...m, error: event.error }
        if (event.type === 'aborted') return { ...m, interrupted: true, tools: m.tools?.map(t => t.status === 'approval' || t.status === 'running' ? { ...t, status: 'denied' as const } : t) }
        return m
      }) }
    }) }))
    if (event.type === 'tool' && event.tool.status === 'done' && event.tool.name === 'write_file') setFileRevision(v => v + 1)
    if (event.type === 'done' || event.type === 'error' || event.type === 'aborted') { activeRef.current = null; setActiveRun(null) }
  }), [])
  useEffect(() => {
    if (autoScroll && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [conversation?.messages, autoScroll])
  const newChat = useCallback((project?: string) => {
    setSelectedId(null); setView('workspace'); setProjectId(project); setDraft(''); setAttachments([]); setQuery(''); setAutoScroll(true); setMoreOpen(false); setFocusKey(v => v + 1)
  }, [])
  const selectChat = (chat: Conversation) => {
    setSelectedId(chat.id); setView('workspace'); setProjectId(chat.projectId); setProvider(chat.provider); setModel(chat.model); setMode(chat.mode); setDraft(''); setAttachments([]); setAutoScroll(true); setMoreOpen(false)
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); if (!stateRef.current.settingsOpen) newChat() }
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); setSettingsOpen(v => !v) }
      if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!stateRef.current.settingsOpen) { setView('history'); setTimeout(() => document.getElementById('chat-search')?.focus(), 30) } }
      if (e.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [newChat])
  const openProject = async () => {
    try {
      const project = await bridge.openProject()
      if (!project) return
      setData(current => ({ ...current, projects: [project, ...current.projects.filter(p => p.id !== project.id)] }))
      newChat(project.id); setFilesOpen(true)
    } catch (error) { notify(errorText(error)) }
  }
  const attachFiles = async () => {
    try {
      const files = await bridge.pickFiles()
      setAttachments(a => [...a, ...files].slice(0, 10))
    } catch (error) { notify(errorText(error)) }
  }
  const send = async () => {
    if (!draft.trim() || activeRef.current) return
    const config = settings.providers.find(p => p.id === provider)!
    if (!isConfigured(config)) { openSettings(provider); notify('Verbinde zuerst einen Anbieter. Dein Entwurf bleibt erhalten.'); return }
    if (attachments.reduce((sum, f) => sum + f.content.length, 0) > 300000) { notify('Die angehängten Dateien sind zusammen zu groß. Bitte etwas Kontext entfernen.'); return }
    const now = Date.now(), id = selectedId || crypto.randomUUID(), assistantId = crypto.randomUUID(), requestId = crypto.randomUUID()
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: draft.trim(), createdAt: now, attachments: attachments.length ? attachments : undefined }
    const assistant: Message = { id: assistantId, role: 'assistant', content: '', createdAt: now, model }
    const previous = conversation?.messages || []
    const messages = [...previous, user]
    const apiMessages = conversation?.apiMessages?.length && conversation.provider === provider && conversation.model === model ? [...conversation.apiMessages, { role: 'user', content: withAttachments(user) }] : undefined
    const chat: Conversation = { ...conversation, id, title: conversation?.title || draft.trim().split('\n')[0].slice(0, 65), projectId: conversation?.projectId ?? projectId, provider, model, mode, messages: [...messages, assistant], apiMessages: undefined, updatedAt: now }
    const run = { requestId, conversationId: id, messageId: assistantId }
    activeRef.current = run; setActiveRun(run); setSelectedId(id); setAutoScroll(true); setView('workspace'); setDraft(''); setAttachments([])
    setData(current => ({ ...current, conversations: [chat, ...current.conversations.filter(c => c.id !== id)] }))
    try {
      await bridge.startChat({ requestId, conversationId: id, provider, model, mode, projectId: chat.projectId, messages: messages.filter(m => m.content).map(m => ({ role: m.role, content: withAttachments(m) })), apiMessages })
    } catch (error) {
      setData(current => ({ ...current, conversations: current.conversations.map(c => c.id !== id ? c : { ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, error: errorText(error) } : m) }) }))
      activeRef.current = null; setActiveRun(null)
    }
  }
  const exportChat = async () => {
    setMoreOpen(false)
    if (!conversation) return
    const markdown = `# ${conversation.title}\n\n${conversation.messages.map(m => `## ${m.role === 'user' ? 'Du' : 'Koda'}\n\n${m.content}${m.tools?.map(t => `\n\n### ${t.name}\n\n\`\`\`json\n${JSON.stringify(t.input, null, 2)}\n\`\`\`\n\n${t.output || t.status}`).join('') || ''}`).join('\n\n---\n\n')}`
    try { if (await bridge.exportChat(conversation.title, markdown)) notify('Chat als Markdown exportiert.') } catch (error) { notify(errorText(error)) }
  }
  const deleteChat = () => {
    if (!deleteTarget || activeRef.current?.conversationId === deleteTarget) return
    setData(current => ({ ...current, conversations: current.conversations.filter(c => c.id !== deleteTarget) }))
    if (selectedId === deleteTarget) newChat(projectId)
    setDeleteTarget(null); notify('Chat gelöscht.')
  }
  const filteredChats = data.conversations.filter(c => !query || `${c.title} ${c.messages.map(m => m.content).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt)
  const suggestions = [
    { icon: FolderSearchIcon, title: 'Ein Projekt verstehen', text: 'Gib mir einen Überblick über die Architektur dieses Projekts. Welche Dateien sollte ich zuerst lesen?' },
    { icon: Terminal, title: 'Einen Fehler beheben', text: 'Hilf mir, einen Fehler einzugrenzen. Schau dir zuerst das Projekt an und frag mich dann nach dem konkreten Problem.' },
    { icon: Code2, title: 'Etwas Neues bauen', text: 'Ich möchte eine neue Funktion entwickeln. ' },
  ]
  const composer = <Composer draft={draft} onDraft={setDraft} attachments={attachments} onRemoveAttachment={index => setAttachments(a => a.filter((_, i) => i !== index))} onAttach={() => void attachFiles()} project={selectedProject} onProject={() => selectedProject ? setFilesOpen(v => !v) : void openProject()} mode={mode} onMode={setMode} provider={provider} model={model} settings={settings} onSelectModel={(id, model) => { setProvider(id); setModel(model) }} onSettings={openSettings} onSend={() => void send()} onStop={() => { if (activeRef.current) void bridge.stopChat(activeRef.current.requestId).catch(error => notify(errorText(error))) }} busy={!!activeRun} compact={!!conversation} focusKey={focusKey}/>
  if (loadError) return <div className="startup-error"><Mark size={36}/><h2>Koda konnte deine Daten nicht laden.</h2><p>{loadError}</p><button className="button secondary" onClick={() => window.location.reload()}>Erneut versuchen</button></div>
  return <div className="app-shell" style={{ '--chat-font-size': `${settings.fontSize}px` } as CSSProperties}>
    <div className="titlebar"><div className="titlebar-brand"><Mark size={16}/><span>Koda</span></div><div className="titlebar-center">Dein Coding-Workspace</div><div className="window-controls"><UpdateButton state={updateState} busy={!!activeRun} beforeRestart={beforeRestart} notify={notify}/>{!bridge.desktop && <span className="preview-label">Browser-Vorschau</span>}<button aria-label="Fenster minimieren" onClick={() => bridge.windowAction('minimize')}><Minus size={14}/></button><button aria-label="Fenster maximieren" onClick={() => bridge.windowAction('maximize')}><Square size={11}/></button><button aria-label="Fenster schließen" onClick={() => bridge.windowAction('close')}><X size={16}/></button></div></div>
    <div className="app-body">
      {sidebar && <aside className="sidebar"><div className="sidebar-top"><button className="wordmark" onClick={() => newChat()}><Mark size={27}/><span>koda<span className="brand-period">.</span></span></button><button className="icon-button sidebar-collapse" title="Seitenleiste ausblenden" onClick={() => setSidebar(false)}><PanelLeftClose size={16}/></button></div>
        <button className="new-chat-button" onClick={() => newChat()}><Plus size={16}/><span>Neuer Chat</span><kbd>Ctrl N</kbd></button>
        <nav className="main-nav" aria-label="Hauptnavigation"><button className={view === 'workspace' ? 'active' : ''} onClick={() => setView('workspace')}><MessageSquare size={16}/><span>Workspace</span><span className="nav-dot"/></button><button className={view === 'projects' ? 'active' : ''} onClick={() => { setView('projects'); setQuery('') }}><Folder size={16}/><span>Projekte</span>{data.projects.length > 0 && <span className="nav-count">{data.projects.length}</span>}</button><button className={view === 'history' ? 'active' : ''} onClick={() => { setView('history'); setQuery('') }}><History size={16}/><span>Verlauf</span><kbd>Ctrl K</kbd></button></nav>
        <div className="sidebar-section"><div className="sidebar-section-title"><span>PROJEKTE</span><button className="icon-button" title="Projektordner hinzufügen" onClick={() => void openProject()}><Plus size={14}/></button></div>{data.projects.length ? data.projects.map(project => <button key={project.id} className={`project-item ${selectedProject?.id === project.id ? 'selected' : ''}`} onClick={() => { newChat(project.id); setFilesOpen(true) }} title={project.path}><Folder size={14}/><span>{project.name}</span><ChevronRight size={12}/></button>) : <button className="open-project-tile" onClick={() => void openProject()}><FolderOpen size={17}/><span>Projekt öffnen<small>Lokalen Ordner auswählen</small></span><Plus size={13}/></button>}</div>
        <div className="sidebar-chats"><div className="sidebar-section-title"><span>LETZTE CHATS</span>{data.conversations.length > 6 && <button className="text-link" onClick={() => setView('history')}>Alle</button>}</div>{data.conversations.length ? [...data.conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map(chat => <button className={`recent-chat ${selectedId === chat.id && view === 'workspace' ? 'selected' : ''}`} key={chat.id} onClick={() => selectChat(chat)}><MessageSquare size={13}/><span>{chat.title}</span>{activeRun?.conversationId === chat.id && <LoaderCircle size={12} className="spin"/>}</button>) : <p className="empty-recent">Deine Chats erscheinen hier.</p>}</div>
        <div className="sidebar-bottom">{configured.length === 0 ? <button className="connect-nudge" onClick={() => openSettings()}><div className="nudge-icon"><KeyRound size={15}/></div><span>Dein Modell fehlt noch<small>API-Key verbinden <ArrowUpRight size={10}/></small></span><ChevronRight size={13}/></button> : <button className="provider-summary" onClick={() => openSettings()}><span className="connected-dot"/><span>{configured.length} {configured.length === 1 ? 'Anbieter verbunden' : 'Anbieter verbunden'}</span><Settings2 size={13}/></button>}
          <button className="sidebar-settings" onClick={() => openSettings()}><Settings2 size={16}/><span>Einstellungen</span><kbd>Ctrl ,</kbd></button><div className="user-row"><span className="avatar">J</span><span>Dein Workspace</span><span className="version">v{__APP_VERSION__}</span></div></div>
      </aside>}
      <main className={`main-area ${filesOpen ? 'with-panel' : ''}`}><header className="workspace-header"><div className="breadcrumb">{!sidebar && <button className="icon-button" title="Seitenleiste anzeigen" onClick={() => setSidebar(true)}><PanelLeftOpen size={17}/></button>}<span className="breadcrumb-root">{selectedProject && view === 'workspace' ? selectedProject.name : 'Persönlicher Workspace'}</span><ChevronRight size={13}/><span>{view === 'projects' ? 'Projekte' : view === 'history' ? 'Verlauf' : conversation?.title || 'Neuer Chat'}</span></div><div className="header-actions">{conversation && view === 'workspace' && <div className="menu-anchor"><button className="icon-button" title="Chat-Optionen" onClick={() => setMoreOpen(!moreOpen)}><Ellipsis size={19}/></button>{moreOpen && <div className="dropdown chat-options"><button onClick={() => void exportChat()}><Download size={14}/> Chat exportieren</button><button className="danger" disabled={activeRun?.conversationId === conversation.id} onClick={() => { setMoreOpen(false); setDeleteTarget(conversation.id) }}><Trash2 size={14}/> Chat löschen</button></div>}</div>}<button className={`header-files ${filesOpen ? 'active' : ''}`} onClick={() => setFilesOpen(v => !v)}><PanelRight size={15}/><span>Dateien</span></button></div></header>
        {view === 'workspace' && !conversation && <div className="welcome-scroll"><div className="welcome"><div className="welcome-eyebrow"><span/> DEIN WORKSPACE</div><h1>Was bauen wir heute?</h1><p className="welcome-subtitle">Öffne ein Projekt oder starte mit einer Idee.</p><div className="welcome-composer">{composer}</div><div className="suggestions">{suggestions.map(item => <button key={item.title} onClick={() => { setDraft(item.text); setFocusKey(v => v + 1) }}><item.icon size={16}/><span>{item.title}</span><ArrowUpRight size={13}/></button>)}</div>
          {configured.length === 0 ? <button className="setup-banner" onClick={() => openSettings()}><span className="setup-icon"><KeyRound size={19}/></span><span className="setup-text"><strong>Verbinde dein erstes Modell.</strong><small>OpenAI, Claude, Gemini, Grok oder dein eigener Endpoint.</small></span><span className="setup-link">API-Key hinzufügen <ArrowRight size={14}/></span></button> : <div className="ready-banner"><span className="connected-dot"/><span>{providerMeta(provider).name} ist bereit.</span><button className="text-link" onClick={() => openSettings()}>Anbieter verwalten <ArrowUpRight size={12}/></button></div>}
          <div className="welcome-footnote"><span><LockKeyhole size={12}/> Lokal gespeichert</span><i/><span><ArrowUpRight size={12}/> Direkt zu deinem Anbieter</span></div>
        </div><footer className="workspace-footer"><span>KODA {__APP_VERSION__}</span><span/><span>CTRL , EINSTELLUNGEN</span></footer></div>}
        {view === 'workspace' && conversation && <div className="conversation-layout"><div className="messages-scroll" ref={scrollRef} onScroll={() => { const element = scrollRef.current; if (element) setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 140) }}><div className="messages"><div className="chat-date">{new Date(conversation.messages[0]?.createdAt || conversation.updatedAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}</div>{conversation.messages.map(message => <article key={message.id} className={`message ${message.role}`}><div className="message-heading">{message.role === 'assistant' ? <span className="assistant-avatar"><Mark size={17}/></span> : <span className="message-user-avatar">Du</span>}<strong>{message.role === 'assistant' ? 'Koda' : 'Du'}</strong>{message.role === 'assistant' && <span>{modelLabel(message.model || conversation.model)}</span>}<time>{new Date(message.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</time></div><div className="message-body">{message.role === 'user' ? <p className="user-content">{message.content}</p> : message.content ? <Markdown content={message.content}/> : null}{message.attachments?.length ? <div className="message-attachments">{message.attachments.map((a, i) => <span key={i}><FileCode2 size={13}/>{a.name}</span>)}</div> : null}{message.tools?.map(tool => <ToolCard key={tool.id} tool={tool} onApprove={approved => { if (activeRef.current) void bridge.approveTool(activeRef.current.requestId, tool.id, approved).catch(error => notify(errorText(error))) }}/>) }{message.error && <div className="message-error"><span>{message.error}</span><button className="text-link" onClick={() => openSettings(conversation.provider)}>Einstellungen <ArrowUpRight size={12}/></button></div>}{message.interrupted && <span className="interrupted-label">Antwort gestoppt</span>}{activeRun?.messageId === message.id && <ChatActivity message={message}/>}{message.role === 'assistant' && message.content && activeRun?.messageId !== message.id && <div className="message-actions"><button className="icon-button" title="Antwort kopieren" onClick={async () => { try { await navigator.clipboard.writeText(message.content); setCopied(message.id); setTimeout(() => setCopied(null), 1800) } catch { notify('Kopieren ist gerade nicht verfügbar.') } }}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button>{message.error && <button className="text-link" onClick={() => { const index = conversation.messages.indexOf(message); const previous = conversation.messages.slice(0, index).reverse().find(m => m.role === 'user'); if (previous) { setDraft(previous.content); setAttachments(previous.attachments || []); setFocusKey(v => v + 1) } }}>Entwurf erneut öffnen</button>}</div>}</div></article>)}</div></div>{!autoScroll && <button className="scroll-bottom icon-button" title="Zur neuesten Nachricht" onClick={() => setAutoScroll(true)}><ArrowDown size={17}/></button>}<div className="chat-composer-wrap">{composer}</div></div>}
        {view === 'projects' && <div className="library-view"><div className="library-heading"><div><span className="eyebrow">DEIN ARBEITSPLATZ</span><h1>Projekte</h1><p>Deine lokalen Ordner und die zugehörigen Chats.</p></div><button className="button primary" onClick={() => void openProject()}><Plus size={15}/> Projekt öffnen</button></div>{data.projects.length ? <div className="project-grid">{data.projects.map(project => <button className="project-card" key={project.id} onClick={() => { newChat(project.id); setFilesOpen(true) }}><div className="project-card-top"><span className="project-card-icon"><FolderOpen size={23}/></span><ArrowUpRight size={17}/></div><h3>{project.name}</h3><p title={project.path}>{project.path}</p><div><span>{data.conversations.filter(c => c.projectId === project.id).length} Chats</span><span>Öffnen <ArrowRight size={12}/></span></div></button>)}</div> : <div className="library-empty"><div className="empty-project-art"><FolderOpen size={45} strokeWidth={1.2}/><span><Code2 size={17}/></span></div><h2>Öffne dein erstes Projekt.</h2><p>Öffne einen lokalen Projektordner. Koda kann die Struktur<br/>verstehen und mit dir an den Dateien arbeiten.</p><button className="button secondary" onClick={() => void openProject()}><FolderOpen size={15}/> Ersten Ordner öffnen</button><small>Deine Dateien bleiben auf deinem Gerät.</small></div>}</div>}
        {view === 'history' && <div className="library-view history-view"><div className="library-heading"><div><span className="eyebrow">VERLAUF</span><h1>Deine Chats</h1><p>Suche in deinen bisherigen Gesprächen.</p></div><button className="button secondary" onClick={() => newChat()}><Plus size={15}/> Neuer Chat</button></div><div className="history-search"><Search size={17}/><input id="chat-search" placeholder="Chats durchsuchen …" value={query} onChange={e => setQuery(e.target.value)} aria-label="Chats durchsuchen"/>{query && <button className="icon-button" aria-label="Suche leeren" onClick={() => setQuery('')}><X size={15}/></button>}</div>{filteredChats.length ? <div className="history-list">{filteredChats.map(chat => <div className="history-item" key={chat.id}><button onClick={() => selectChat(chat)}><span className="history-icon"><MessageSquare size={18}/></span><span><strong>{chat.title}</strong><small>{data.projects.find(p => p.id === chat.projectId)?.name || 'Ohne Projekt'} <i>·</i> {chat.messages.filter(m => m.role === 'user').length} Nachrichten <i>·</i> {modelLabel(chat.model)}</small></span><time>{new Date(chat.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}</time><ChevronRight size={15}/></button><button className="icon-button delete-history" title="Chat löschen" disabled={activeRun?.conversationId === chat.id} onClick={() => setDeleteTarget(chat.id)}><Trash2 size={14}/></button></div>)}</div> : <div className="library-empty history-empty"><div className="empty-icon"><MessageSquare size={29}/></div><h2>{query ? 'Kein Chat gefunden.' : 'Noch keine Chats.'}</h2><p>{query ? 'Versuche einen anderen Suchbegriff.' : 'Deine Gespräche werden hier automatisch gespeichert.'}</p>{!query && <button className="button secondary" onClick={() => newChat()}><Plus size={14}/> Ersten Chat starten</button>}</div>}</div>}
        {!loaded && <div className="loading-overlay"><LoaderCircle size={23} className="spin"/></div>}
      </main>
      {filesOpen && <FilePanel project={selectedProject} revision={fileRevision} onClose={() => setFilesOpen(false)} onAttach={file => { setAttachments(a => [...a, file].slice(0, 10)); notify(`${file.name} als Kontext hinzugefügt.`) }} notify={notify} onOpenProject={() => void openProject()}/>}
    </div>
    {settingsOpen && <Settings settings={settings} initialProvider={initialProvider} onUpdate={updated => { setSettings(updated); const chosen = updated.providers.find(p => p.id === provider)!; if (chosen.model !== settings.providers.find(p => p.id === provider)?.model) setModel(chosen.model); if (!configured.length) { const newlyConfigured = updated.providers.find(isConfigured); if (newlyConfigured) { setProvider(newlyConfigured.id); setModel(newlyConfigured.model) } } }} onClose={() => setSettingsOpen(false)} notify={notify}/>}
    {deleteTarget && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><span className="delete-icon"><Trash2 size={23}/></span><h2 id="delete-title">Diesen Chat löschen?</h2><p>Der lokale Verlauf dieses Gesprächs wird entfernt. Projektdateien bleiben erhalten.</p><div><button className="button secondary" autoFocus onClick={() => setDeleteTarget(null)}>Abbrechen</button><button className="button danger-button" onClick={deleteChat}>Chat löschen</button></div></div></div>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="Hinweis schließen" onClick={() => setToast('')}><X size={14}/></button></div>}
  </div>
}

function FolderSearchIcon({ size = 16 }: { size?: number }) { return <Folder size={size}/> }
