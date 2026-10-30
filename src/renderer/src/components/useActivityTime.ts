import { useEffect, useRef, useState } from 'react'
import { formatElapsed, validElapsed } from '../../../shared/activity-time'

export function useActivityTime(id: string, running: boolean, elapsedMs?: number): string | null {
  const anchor = useRef({ base: 0, at: performance.now() })
  const [elapsed, setElapsed] = useState(validElapsed(elapsedMs) ? elapsedMs : 0)
  useEffect(() => {
    anchor.current = { base: validElapsed(elapsedMs) ? elapsedMs : 0, at: performance.now() }
    setElapsed(anchor.current.base)
  }, [id, elapsedMs])
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setElapsed(anchor.current.base + performance.now() - anchor.current.at), 250)
    return () => clearInterval(timer)
  }, [id, running])
  // Old wall-clock timestamps cannot reliably reconstruct execution time.
  // Completed records use the backend's measured duration and never keep ticking.
  return running ? formatElapsed(elapsed) : validElapsed(elapsedMs) ? formatElapsed(elapsedMs) : null
}
