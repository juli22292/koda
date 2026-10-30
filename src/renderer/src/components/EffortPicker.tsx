import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Brain, Check, ChevronDown } from 'lucide-react'
import type { ProviderId, ReasoningEffort } from '../../../shared/types'
import { effortLabels, effortSupport, normalizeEffort } from '../../../shared/effort'

export function EffortPicker({ provider, model, value, disabled, onChange, onOpen }: { provider: ProviderId; model: string; value: ReasoningEffort; disabled: boolean; onChange(value: ReasoningEffort): void; onOpen(): void }) {
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(450)
  const root = useRef<HTMLDivElement>(null)
  const support = effortSupport(provider, model)
  const selected = normalizeEffort(provider, model, value)
  useEffect(() => { setOpen(false) }, [provider, model])
  useLayoutEffect(() => {
    if (!open) return
    const resize = () => setHeight(Math.max(170, (root.current?.getBoundingClientRect().top ?? 470) - 20))
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [open])
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', keyboard) }
  }, [])
  if (!support) return null
  return <div className="menu-anchor effort-anchor" ref={root}>
    <button className="effort-button" aria-label={`Effort: ${effortLabels[selected]}`} title="Denkaufwand für dieses Modell" aria-expanded={open} disabled={disabled} onClick={() => { if (!open) onOpen(); setOpen(v => !v) }}><Brain size={13}/><span>{effortLabels[selected]}</span><ChevronDown size={10}/></button>
    {open && <div className="dropdown effort-menu" style={{ maxHeight: height }} role="menu" aria-label="Effort auswählen"><span className="dropdown-label">EFFORT</span><div className="effort-options">{(['auto', ...support.levels] as ReasoningEffort[]).map(level => <button key={level} role="menuitemradio" aria-checked={selected === level} onClick={() => { onChange(level); setOpen(false) }}><span>{effortLabels[level]}{level === 'auto' && <small>Vorgabe des Anbieters</small>}</span>{selected === level && <Check size={13}/>}</button>)}</div><p>Nur unterstützte Stufen dieses Modells. Mehr Effort kann länger dauern und mehr Tokens verwenden.</p></div>}
  </div>
}
