import type { AppData } from './types'

export function validElapsed(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
export function formatElapsed(milliseconds: number): string {
  const value = validElapsed(milliseconds) ? milliseconds : 0
  if (value < 60_000) return `${(value / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
  const seconds = Math.floor(value / 1000), minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}
export function activityClock(now: () => number = () => performance.now()): () => number {
  const start = now()
  return () => Math.max(0, now() - start)
}
// Agent executions cannot survive a process restart. Do not resume an old live
// counter from wall-clock timestamps or show a finished task as still running.
export function restoreInterruptedActivities(data: AppData): AppData {
  return { ...data, conversations: data.conversations.map(chat => ({ ...chat, messages: chat.messages.map(message => {
    const interrupted = message.tools?.some(tool => tool.status === 'running' || tool.status === 'approval')
    return interrupted ? { ...message, interrupted: true, tools: message.tools!.map(tool => tool.status === 'running' || tool.status === 'approval' ? { ...tool, status: 'cancelled' as const } : tool) } : message
  }) })) }
}
