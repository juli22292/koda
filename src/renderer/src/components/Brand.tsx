export function Mark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={`koda-mark ${className}`} aria-hidden="true">
    <path d="M10.5 8 3 16l7.5 8M21.5 8 29 16l-7.5 8M18.5 5 13.5 27" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
export function ProviderIcon({ id, size = 28 }: { id: string; size?: number }) {
  return <span className={`provider-icon provider-${id}`} style={{ width: size, height: size, fontSize: size * .48 }} aria-hidden="true">
    {id === 'openai' ? <svg viewBox="0 0 24 24" width={size * .64} height={size * .64} fill="none"><path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.7"/><path d="m12 3 0 9 7.8 4.5M4.2 7.5 7.8 6l8 4.5v9M4.2 16.5l7.8-4.5 0 9" stroke="currentColor" strokeWidth="1.5"/></svg>
      : id === 'anthropic' ? <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700 }}>A</span>
      : id === 'google' ? <svg viewBox="0 0 24 24" width={size * .64} height={size * .64} fill="currentColor"><path d="M12 1c.7 6.9 4.1 10.3 11 11-6.9.7-10.3 4.1-11 11C11.3 16.1 7.9 12.7 1 12 7.9 11.3 11.3 7.9 12 1Z"/></svg>
      : id === 'xai' ? <span style={{ fontWeight: 500 }}>𝕏</span> : id === 'unorouter' ? <span style={{ fontWeight: 650 }}>U</span> : <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{'>'}</span>}
  </span>
}
