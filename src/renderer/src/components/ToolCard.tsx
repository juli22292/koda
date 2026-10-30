import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines } from 'diff'
import { Check, ChevronDown, FileArchive, FileCode2, FolderOpen, FolderSearch, Hammer, LoaderCircle, ShieldCheck, ShieldOff, Terminal, X } from 'lucide-react'
import type { ToolActivity } from '../../../shared/types'
import { useActivityTime } from './useActivityTime'

export function ToolCard({ tool, active, onApprove, onRevealArtifact }: { tool: ToolActivity; active: boolean; onApprove(approved: boolean): void; onRevealArtifact(path: string): void }) {
  const status = !active && (tool.status === 'running' || tool.status === 'approval') ? 'cancelled' : tool.status
  const isWrite = tool.name === 'write_file'
  const isBuild = tool.name === 'build_project'
  const isCommand = tool.name === 'run_command' || isBuild
  const pending = status === 'approval'
  const running = status === 'running'
  const [expanded, setExpanded] = useState(pending || isCommand)
  const outputRef = useRef<HTMLPreElement>(null)
  const followOutput = useRef(true)
  useEffect(() => {
    if (pending || (isCommand && running)) setExpanded(true)
  }, [pending, running, isCommand])
  useEffect(() => {
    if (outputRef.current && followOutput.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [tool.output, expanded])
  const duration = useActivityTime(tool.id, running, tool.elapsedMs)
  const diff = useMemo(() => isWrite ? diffLines(tool.before ?? '', String(tool.input.content ?? '')) : [], [tool.before, tool.input.content, isWrite])
  const Icon = isBuild ? Hammer : isCommand ? Terminal : isWrite ? FileCode2 : tool.name === 'list_files' ? FolderSearch : FileCode2
  const title = isBuild ? 'Projekt kompilieren' : isCommand ? 'Befehl ausführen' : isWrite ? 'Datei ändern' : tool.name === 'list_files' ? 'Projekt durchsuchen' : tool.name === 'inspect_build' ? 'Build-Umgebung prüfen' : 'Datei lesen'
  const detail = isBuild ? `Java ${tool.input.javaVersion} · ${tool.input.command}` : String(tool.input.path ?? tool.input.command ?? '')
  const stateLabel = pending ? 'Freigabe nötig' : running ? 'Läuft' : status === 'done' ? 'Abgeschlossen' : status === 'cancelled' ? 'Gestoppt' : status === 'denied' ? 'Abgelehnt' : 'Fehlgeschlagen'
  return <div className={`tool-card ${status} ${pending ? 'pending' : ''} ${isCommand ? 'command-card' : ''}`}>
    <button className="tool-header" onClick={() => setExpanded(!expanded)} aria-expanded={expanded || pending}>
      <Icon size={15}/><span>{title}<code title={detail}>{detail.slice(0, 110)}</code></span>
      {tool.automatic && <span className="automatic-label" title="Ohne Rückfrage im Vollzugriff ausgeführt"><ShieldOff size={11}/>Vollzugriff</span>}
      {pending ? <span className="approval-label">{stateLabel}</span> : running ? isCommand ? <span className="tool-live-label"><i/>Läuft</span> : <LoaderCircle size={14} className="spin"/> : status === 'done' ? <Check size={14} className="success-text"/> : <X size={14} className={status === 'error' ? 'danger' : 'muted'}/>}
      {duration && <span className="tool-time" title={isBuild ? 'Ausführungszeit einschließlich Werkzeugeinrichtung' : 'Ausführungszeit'}>{duration}</span>}<ChevronDown size={13} className={expanded ? 'rotated' : ''}/>
    </button>
    {running && isCommand && <div className="tool-running-progress" aria-label="Befehl läuft"><span/></div>}
    {(expanded || pending) && <div className="tool-detail">
      {isWrite ? <div className="diff-view">{diff.map((part, i) => <pre key={i} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value.split('\n').filter((_, i, a) => i !== a.length - 1 || a[i]).map((line, j) => <div key={j}><span>{part.added ? '+' : part.removed ? '−' : ' '}</span>{line || ' '}</div>)}</pre>)}</div> : isCommand ? <>
        <p>{String(tool.input.explanation || 'Befehl im Projektordner ausführen.')}</p>
        <div className="command-console"><div className="command-console-heading"><Terminal size={12}/><span>{isBuild ? 'Build-Ausgabe' : 'Terminal'}</span><span>{stateLabel}</span></div><pre className="command-preview"><span className="terminal-prompt">› </span>{String(tool.input.command)}</pre>
          {!pending && <pre className="tool-output terminal-output" role="log" aria-live="off" aria-label="Befehlsausgabe" ref={outputRef} onScroll={event => { const element = event.currentTarget; followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40 }}>{tool.output || (running ? 'Warte auf Ausgabe …' : 'Keine Ausgabe.')}{running && <span className="terminal-cursor" aria-hidden="true"/>}</pre>}
        </div>
        {pending && <p className="permission-hint">{isBuild ? 'Der Build führt Projektcode aus. Fehlende JDKs und Build-Werkzeuge werden im Koda-Werkzeugordner heruntergeladen und eingerichtet.' : 'Der Befehl läuft mit deinen Benutzerrechten im Projektordner.'}</p>}
      </> : <pre className="tool-output">{tool.output?.slice(0, 12000) || (running ? 'Wird gelesen …' : 'Keine Ausgabe.')}</pre>}
      {!isCommand && isWrite && status === 'error' && <p className="danger">{tool.output}</p>}
      {!!tool.artifacts?.length && <div className="build-artifacts" aria-label="Gebautes Ergebnis">{tool.artifacts.map(artifact => <div className="build-artifact" key={artifact.path}><FileArchive size={18}/><span><strong>{artifact.name}</strong><small>{artifact.kind === 'plugin' ? 'Plugin-JAR' : 'JAR'} · {Math.max(1, Math.round(artifact.size / 1024))} KB</small><code>{artifact.path}</code></span><button className="button secondary small" title={artifact.path} onClick={() => onRevealArtifact(artifact.path)}><FolderOpen size={13}/> Im Ordner anzeigen</button></div>)}</div>}
      {pending && <div className="approval-actions"><span><ShieldCheck size={13}/> Einmalige Freigabe</span><button className="button secondary small" onClick={() => onApprove(false)}><X size={13}/> Ablehnen</button><button className="button primary small" onClick={() => onApprove(true)}><Check size={13}/> {isWrite ? 'Änderung übernehmen' : isBuild ? 'Kompilieren' : 'Ausführen'}</button></div>}
      {(status === 'denied' || status === 'cancelled') && <p className="muted">{status === 'cancelled' ? 'Ausführung gestoppt.' : 'Aktion abgelehnt.'}</p>}
    </div>}
  </div>
}
