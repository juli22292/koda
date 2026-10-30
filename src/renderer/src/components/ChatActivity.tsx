import { LoaderCircle } from 'lucide-react'
import type { Message } from '../../../shared/types'

export function ChatActivity({ message }: { message: Message }) {
  // An active tool card already shows the current work and its animation.
  if (message.tools?.some(tool => tool.status === 'running' || tool.status === 'approval')) return null
  const label = message.content || message.tools?.length ? 'Koda arbeitet …' : 'Koda denkt nach …'

  return <div className="run-status" role="status" aria-live="polite">
    <LoaderCircle size={13} className="spin"/>
    <span>{label}</span>
  </div>
}
