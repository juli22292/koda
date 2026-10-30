import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Eye, ShieldCheck, ShieldOff } from 'lucide-react'
import type { PermissionMode } from '../../../shared/types'

const choices = [
  { id: 'read-only', label: 'Nur lesen', description: 'Projekt lesen, keine Änderungen oder Befehle', icon: Eye },
  { id: 'ask', label: 'Nachfragen', description: 'Änderungen und Befehle einzeln bestätigen', icon: ShieldCheck },
  { id: 'full-access', label: 'Vollzugriff', description: 'Änderungen und Befehle ohne Rückfrage ausführen', icon: ShieldOff },
] as const

export function PermissionPicker({ value, disabled, onChange, onOpen }: { value: PermissionMode; disabled: boolean; onChange(value: PermissionMode): void; onOpen(): void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = choices.find(item => item.id === value) || choices[1]
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', keyboard) }
  }, [])
  return <div className="menu-anchor permission-anchor" ref={root}>
    <button className={`permission-button ${value === 'full-access' ? 'full-access' : ''}`} aria-label={`Berechtigungen: ${selected.label}`} aria-expanded={open} disabled={disabled} onClick={() => { if (!open) onOpen(); setOpen(v => !v) }}><selected.icon size={13}/><span>{selected.label}</span><ChevronDown size={10}/></button>
    {open && <div className="dropdown permission-menu" role="menu" aria-label="Berechtigungen"><span className="dropdown-label">BERECHTIGUNGEN FÜR DIESEN CHAT</span>{choices.map(item => <button key={item.id} role="menuitemradio" aria-checked={value === item.id} className={value === item.id ? 'selected' : ''} onClick={() => { onChange(item.id); setOpen(false) }}><item.icon size={16}/><span><strong>{item.label}</strong><small>{item.description}</small></span>{value === item.id && <Check size={13}/>}</button>)}<p>Vollzugriff nutzt deine Benutzerrechte. Dateiwerkzeuge arbeiten im Projekt; Terminalbefehle können darüber hinaus zugreifen.</p></div>}
  </div>
}
