import { useMemo, useState } from 'react'
import { diffLines } from 'diff'
import { Check, ChevronDown, ChevronRight, FileCode2, FolderSearch, LoaderCircle, ShieldCheck, Terminal, X } from 'lucide-react'
import type { ToolActivity } from '../../../shared/types'

export function ToolCard({ tool, onApprove }: { tool: ToolActivity; onApprove(approved: boolean): void }) {
  const [expanded, setExpanded] = useState(tool.status === 'approval')
  const pending = tool.status === 'approval'
  const isWrite = tool.name === 'write_file'
  const isCommand = tool.name === 'run_command'
  const diff = useMemo(() => isWrite ? diffLines(tool.before ?? '', String(tool.input.content ?? '')) : [], [tool.before, tool.input.content, isWrite])
  const Icon = isCommand ? Terminal : isWrite ? FileCode2 : tool.name === 'list_files' ? FolderSearch : FileCode2
  const title = isCommand ? 'Terminalbefehl' : isWrite ? 'Datei ändern' : tool.name === 'list_files' ? 'Projekt durchsuchen' : 'Datei lesen'
  return <div className={`tool-card ${pending ? 'pending' : ''}`}><button className="tool-header" onClick={() => setExpanded(!expanded)}><Icon size={15}/><span>{title}<code>{String(tool.input.path ?? tool.input.command ?? '').slice(0, 110)}</code></span>{pending ? <span className="approval-label">Freigabe nötig</span> : tool.status === 'running' ? <LoaderCircle size={14} className="spin"/> : tool.status === 'done' ? <Check size={14} className="success-text"/> : <X size={14} className={tool.status === 'error' ? 'danger' : 'muted'}/>}<ChevronDown size={13} className={expanded ? 'rotated' : ''}/></button>
    {(expanded || pending) && <div className="tool-detail">{isWrite ? <div className="diff-view">{diff.map((part, i) => <pre key={i} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value.split('\n').filter((_, i, a) => i !== a.length - 1 || a[i]).map((line, j) => <div key={j}><span>{part.added ? '+' : part.removed ? '−' : ' '}</span>{line || ' '}</div>)}</pre>)}</div> : isCommand ? <><p>{String(tool.input.explanation || 'Befehl im Projektordner ausführen.')}</p><pre className="command-preview">{String(tool.input.command)}</pre>{pending && <p className="permission-hint">Der Befehl läuft mit deinen Benutzerrechten im Projektordner.</p>}</> : <pre className="tool-output">{tool.output?.slice(0, 12000) || 'Wird gelesen …'}</pre>}{isCommand && tool.output && <pre className="tool-output">{tool.output}</pre>}{tool.status === 'error' && <p className="danger">{tool.output}</p>}
      {pending && <div className="approval-actions"><span><ShieldCheck size={13}/> Einmalige Freigabe</span><button className="button secondary small" onClick={() => onApprove(false)}><X size={13}/> Ablehnen</button><button className="button primary small" onClick={() => onApprove(true)}><Check size={13}/> {isWrite ? 'Änderung übernehmen' : 'Ausführen'}</button></div>}
      {tool.status === 'denied' && <p className="muted">Aktion abgelehnt.</p>}
    </div>}
  </div>
}
