import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronRight, File, FileCode2, Folder, FolderOpen, LoaderCircle, Paperclip, RefreshCw, X } from 'lucide-react'
import { bridge } from '../bridge'
import type { Attachment, FileEntry, Project } from '../../../shared/types'

function TreeNode({ entry, project, depth, onOpen, notify }: { entry: FileEntry; project: Project; depth: number; onOpen(entry: FileEntry): void; notify(message: string): void }) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const toggle = async () => {
    if (!entry.directory) return onOpen(entry)
    if (!expanded) {
      setLoading(true)
      try { setChildren(await bridge.listFiles(project.id, entry.path)); setExpanded(true) }
      catch (error) { notify(String(error)) }
      finally { setLoading(false) }
    } else setExpanded(false)
  }
  return <><button className="tree-entry" onClick={() => void toggle()} style={{ paddingLeft: 13 + depth * 14 }} title={entry.path}>{loading ? <LoaderCircle size={13} className="spin"/> : entry.directory ? expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/> : <span className="tree-indent"/>}{entry.directory ? expanded ? <FolderOpen size={15}/> : <Folder size={15}/> : <FileCode2 size={14}/>}<span>{entry.name}</span></button>{expanded && <div>{children.map(child => <TreeNode key={child.path} entry={child} project={project} depth={depth + 1} onOpen={onOpen} notify={notify}/>)}{children.length === 0 && <span className="tree-empty" style={{ paddingLeft: 40 + depth * 14 }}>Leer</span>}</div>}</>
}
export function FilePanel({ project, revision, onClose, onAttach, notify, onOpenProject }: { project?: Project; revision: number; onClose(): void; onAttach(file: Attachment): void; notify(message: string): void; onOpenProject(): void }) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [attached, setAttached] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    setSelected(null); setContent(''); setError('')
    if (!project) return
    let cancelled = false
    setLoading(true)
    bridge.listFiles(project.id).then(files => { if (!cancelled) setEntries(files) }).catch(error => { if (!cancelled) setError(String(error)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project?.id, revision, refresh])
  const open = async (entry: FileEntry) => {
    if (!project) return
    setLoading(true); setError(''); setAttached(false); setSelected(entry)
    try { setContent(await bridge.readFile(project.id, entry.path)) }
    catch (error) { setError(String(error)); setContent('') }
    finally { setLoading(false) }
  }
  return <aside className={`file-panel ${selected ? 'showing-file' : ''}`}><div className="panel-header"><span><Folder size={15}/> Dateien</span><div><button className="icon-button" title="Dateien aktualisieren" onClick={() => setRefresh(v => v + 1)}><RefreshCw size={14}/></button><button className="icon-button" title="Dateiansicht schließen" onClick={onClose}><X size={16}/></button></div></div>
    {!project ? <div className="panel-empty"><div className="empty-icon"><FolderOpen size={25}/></div><h3>Dein Projekt, im Blick.</h3><p>Öffne einen Ordner, um Dateien zu lesen und als Kontext hinzuzufügen.</p><button className="button secondary" onClick={onOpenProject}><FolderOpen size={14}/> Ordner öffnen</button></div> : selected ? <><div className="file-breadcrumb"><button className="icon-button" title="Zur Dateiliste" onClick={() => setSelected(null)}><ArrowLeft size={14}/></button><span title={selected.path}>{selected.path}</span></div>{loading ? <div className="panel-loading"><LoaderCircle size={18} className="spin"/></div> : error ? <div className="panel-error">{error}</div> : <div className="file-source"><pre>{content.split('\n').map((line, i) => <div className="source-line" key={i}><span className="line-number">{i + 1}</span><span>{line || ' '}</span></div>)}</pre></div>}<div className="panel-footer"><button className="button secondary" disabled={loading || !!error || attached} onClick={() => { onAttach({ name: selected.name, path: selected.path, content }); setAttached(true) }}>{attached ? <Check size={14}/> : <Paperclip size={14}/>} {attached ? 'Zum Chat hinzugefügt' : 'Als Kontext hinzufügen'}</button></div></> : <><div className="project-tree-name"><FolderOpen size={14}/><span title={project.path}>{project.name}</span><span className="file-count">{entries.length}</span></div>{loading ? <div className="panel-loading"><LoaderCircle size={18} className="spin"/></div> : error ? <div className="panel-error">{error}</div> : <div className="file-tree" key={refresh + revision}>{entries.map(entry => <TreeNode key={entry.path} entry={entry} project={project} depth={0} onOpen={entry => void open(entry)} notify={notify}/>)}{entries.length === 0 && <div className="panel-empty small"><File size={22}/><p>Dieser Ordner ist noch leer.</p></div>}</div>}<div className="panel-footer subtle"><span>Nur Dateien im geöffneten Projekt</span></div></>}
  </aside>
}
