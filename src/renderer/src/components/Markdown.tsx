import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { bridge } from '../bridge'

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  return <div className="code-block"><div className="code-toolbar"><span>Code</span><button title="Code kopieren" onClick={async e => {
    const code = e.currentTarget.closest('.code-block')?.querySelector('code')?.textContent ?? ''
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }}>{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? 'Kopiert' : 'Kopieren'}</button></div><pre>{children}</pre></div>
}
export function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href) void bridge.openExternal(href) }}>{children}</a>,
    img: ({ alt }) => <span className="muted">[Bild: {alt || 'Externe Abbildung'}]</span>,
  }}>{content}</ReactMarkdown></div>
}
