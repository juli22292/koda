import { LoaderCircle, ShieldCheck } from 'lucide-react'
import type { Message } from '../../../shared/types'

export function ChatActivity({ message }: { message: Message }) {
  const awaitingApproval = message.tools?.some(tool => tool.status === 'approval')
  const label = awaitingApproval ? 'Wartet auf deine Freigabe' : message.content || message.tools?.length ? 'Koda arbeitet …' : 'Koda denkt nach …'

  return <div className="run-status" role="status" aria-live="polite">
    {awaitingApproval ? <ShieldCheck size={13}/> : <LoaderCircle size={13} className="spin"/>}
    <span>{label}</span>
  </div>
}
