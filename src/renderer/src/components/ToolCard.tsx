import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines } from 'diff'
import { Check, ChevronDown, FileCode2, FolderSearch, LoaderCircle, ShieldCheck, ShieldOff, Terminal, X } from 'lucide-react'
import type { ToolActivity } from '../../../shared/types'

export function ToolCard({ tool, onApprove }: { tool: ToolActivity; onApprove(approved: boolean): void }) {
  const isWrite = tool.name === 'write_file'
  const isCommand = tool.name === 'run_command'
  const pending = tool.status === 'approval'
  const running = tool.status === 'running'
  const [expanded, setExpanded] = useState(pending || isCommand)
  const [now, setNow] = useState(Date.now())
  const outputRef = useRef<HTMLPreElement>(null)
  const followOutput = useRef(true)
  useEffect(() => {
    if (pending || (isCommand && running)) setExpanded(true)
  }, [pending, running, isCommand])
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [running])
  useEffect(() => {
    if (outputRef.current && followOutput.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [tool.output, expanded])
  const duration = tool.startedAt ? Math.max(0, ((tool.finishedAt ?? now) - tool.startedAt) / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null
  const diff = useMemo(() => isWrite ? diffLines(tool.before ?? '', String(tool.input.content ?? '')) : [], [tool.before, tool.input.content, isWrite])
  const Icon = isCommand ? Terminal : isWrite ? FileCode2 : tool.name === 'list_files' ? FolderSearch : FileCode2
  const title = isCommand ? 'Befehl ausführen' : isWrite ? 'Datei ändern' : tool.name === 'list_files' ? 'Projekt durchsuchen' : 'Datei lesen'
  const stateLabel = pending ? 'Freigabe nötig' : running ? 'Läuft' : tool.status === 'done' ? 'Abgeschlossen' : tool.status === 'cancelled' ? 'Gestoppt' : tool.status === 'denied' ? 'Abgelehnt' : 'Fehlgeschlagen'
  return <div className={`tool-card ${tool.status} ${isCommand ? 'command-card' : ''}`}>
    <button className="tool-header" onClick={() => setExpanded(!expanded)} aria-expanded={expanded || pending}>
      <Icon size={15}/><span>{title}<code title={String(tool.input.path ?? tool.input.command ?? '')}>{String(tool.input.path ?? tool.input.command ?? '').slice(0, 110)}</code></span>
      {tool.automatic && <span className="automatic-label" title="Ohne Rückfrage im Vollzugriff ausgeführt"><ShieldOff size={11}/>Vollzugriff</span>}
      {pending ? <span className="approval-label">{stateLabel}</span> : running ? isCommand ? <span className="tool-live-label"><i/>Läuft</span> : <LoaderCircle size={14} className="spin"/> : tool.status === 'done' ? <Check size={14} className="success-text"/> : <X size={14} className={tool.status === 'error' ? 'danger' : 'muted'}/>}
      {duration && <span className="tool-time">{duration} s</span>}<ChevronDown size={13} className={expanded ? 'rotated' : ''}/>
    </button>
    {running && isCommand && <div className="tool-running-progress" aria-label="Befehl läuft"><span/></div>}
    {(expanded || pending) && <div className="tool-detail">
      {isWrite ? <div className="diff-view">{diff.map((part, i) => <pre key={i} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value.split('\n').filter((_, i, a) => i !== a.length - 1 || a[i]).map((line, j) => <div key={j}><span>{part.added ? '+' : part.removed ? '−' : ' '}</span>{line || ' '}</div>)}</pre>)}</div> : isCommand ? <>
        <p>{String(tool.input.explanation || 'Befehl im Projektordner ausführen.')}</p>
        <div className="command-console"><div className="command-console-heading"><Terminal size={12}/><span>Terminal</span><span>{stateLabel}</span></div><pre className="command-preview"><span className="terminal-prompt">› </span>{String(tool.input.command)}</pre>
          {!pending && <pre className="tool-output terminal-output" role="log" aria-live="off" aria-label="Befehlsausgabe" ref={outputRef} onScroll={event => { const element = event.currentTarget; followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40 }}>{tool.output || (running ? 'Warte auf Ausgabe …' : 'Keine Ausgabe.')}{running && <span className="terminal-cursor" aria-hidden="true"/>}</pre>}
        </div>
        {pending && <p className="permission-hint">Der Befehl läuft mit deinen Benutzerrechten im Projektordner.</p>}
      </> : <pre className="tool-output">{tool.output?.slice(0, 12000) || (running ? 'Wird gelesen …' : 'Keine Ausgabe.')}</pre>}
      {!isCommand && isWrite && tool.status === 'error' && <p className="danger">{tool.output}</p>}
      {pending && <div className="approval-actions"><span><ShieldCheck size={13}/> Einmalige Freigabe</span><button className="button secondary small" onClick={() => onApprove(false)}><X size={13}/> Ablehnen</button><button className="button primary small" onClick={() => onApprove(true)}><Check size={13}/> {isWrite ? 'Änderung übernehmen' : 'Ausführen'}</button></div>}
      {(tool.status === 'denied' || tool.status === 'cancelled') && <p className="muted">{tool.status === 'cancelled' ? 'Ausführung gestoppt.' : 'Aktion abgelehnt.'}</p>}
    </div>}
  </div>
}
