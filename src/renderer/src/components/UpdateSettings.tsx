import { useEffect, useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import type { AppUpdateState } from '../../../shared/types'
import { bridge } from '../bridge'

export function UpdateSettings({ notify }: { notify(message: string): void }) {
  const [state, setState] = useState<AppUpdateState>({ status: 'idle', currentVersion: __APP_VERSION__ })
  useEffect(() => {
    const unsubscribe = bridge.onUpdateState(setState)
    void bridge.getUpdateState().then(setState).catch(() => {})
    return unsubscribe
  }, [])
  const busy = ['checking', 'downloading', 'installing'].includes(state.status)
  const text = state.status === 'unsupported' ? 'Automatische Updates sind in der installierten Windows-Version verfügbar.'
    : state.status === 'error' ? state.error
    : state.status === 'available' ? `Version ${state.version} ist verfügbar. Über das Symbol oben rechts herunterladen.`
    : state.status === 'downloaded' ? `Version ${state.version} ist bereit. Über das Symbol oben rechts neu starten.`
    : state.status === 'downloading' ? `Update wird geladen: ${state.percent ?? 0} %`
    : state.status === 'checking' ? 'Neue Version wird gesucht …'
    : state.status === 'installing' ? 'Koda startet neu …'
    : 'Prüft beim Start und alle vier Stunden auf neue Versionen.'
  return <div className="update-settings"><div><Download size={17}/><span><strong>Updates</strong><small>{text}</small></span></div><button className="button secondary" disabled={busy || state.status === 'unsupported'} onClick={async () => {
    try {
      const result = await bridge.checkForUpdates()
      setState(result)
      if (result.status === 'idle') notify('Koda ist auf dem neuesten Stand.')
    } catch { notify('Die Update-Prüfung ist gerade nicht verfügbar.') }
  }}>{state.status === 'checking' ? <LoaderCircle size={13} className="spin"/> : <RefreshCw size={13}/>} Nach Updates suchen</button></div>
}
