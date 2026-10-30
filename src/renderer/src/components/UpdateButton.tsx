import { Download, LoaderCircle, RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { AppUpdateState } from '../../../shared/types'
import { bridge } from '../bridge'

interface Props { state: AppUpdateState; busy: boolean; beforeRestart(): Promise<void>; notify(message: string): void }
export function UpdateButton({ state, busy, beforeRestart, notify }: Props) {
  const [acting, setActing] = useState(false)
  if (!state.version || !['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.status)) return null
  const ready = state.status === 'downloaded'
  const downloading = state.status === 'downloading'
  const installing = state.status === 'installing'
  const disabled = acting || downloading || installing || (ready && busy)
  const label = ready ? busy ? 'Update bereit – nach der laufenden Antwort neu starten' : 'Update installieren und neu starten' : downloading ? `Update wird geladen: ${state.percent ?? 0} %` : installing ? 'Koda startet neu …' : state.status === 'error' ? 'Update erneut herunterladen' : `Update ${state.version} herunterladen`

  return <button type="button" className={`titlebar-update ${ready ? 'ready' : ''} ${state.status === 'error' ? 'failed' : ''}`} aria-label={label} title={label} disabled={disabled} onClick={async () => {
    if (disabled) return
    setActing(true)
    try {
      if (ready) { await beforeRestart(); await bridge.installUpdate() }
      else { const result = await bridge.downloadUpdate(); if (result.status === 'error') notify(result.error || 'Der Update-Download ist fehlgeschlagen.') }
    } catch (error) { notify((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '')) }
    finally { setActing(false) }
  }}>
    {downloading ? <span className="update-progress"><svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" className="update-progress-track"/><circle cx="11" cy="11" r="9" strokeDasharray={`${(state.percent ?? 0) * .5655} 56.55`}/></svg><Download size={11}/></span> : installing || acting ? <LoaderCircle size={16} className="spin"/> : ready ? <RotateCw size={17}/> : <Download size={17}/>}
    {!downloading && !installing && <span className="update-badge"/>}
  </button>
}
