import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, CheckCircle2, ChevronRight, CircleHelp, Eye, EyeOff, KeyRound, Laptop, LoaderCircle, LockKeyhole, Monitor, Moon, Palette, Settings2, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
import { bridge } from '../bridge'
import type { ProviderId, Settings as SettingsType, Theme } from '../../../shared/types'
import { isConfigured, modelLabel, PROVIDERS, providerMeta } from '../../../shared/providers'
import { Mark, ProviderIcon } from './Brand'
import { UpdateSettings } from './UpdateSettings'

type Section = 'providers' | 'appearance' | 'general' | 'about'
interface Props { settings: SettingsType; initialProvider?: ProviderId; initialSection?: Section; onUpdate(settings: SettingsType): void; onClose(): void; notify(message: string): void }
export function Settings({ settings, initialProvider, initialSection, onUpdate, onClose, notify }: Props) {
  const [section, setSection] = useState<Section>(initialSection || 'providers')
  const [provider, setProvider] = useState<ProviderId>(initialProvider || 'openai')
  const config = settings.providers.find(p => p.id === provider)!
  const meta = providerMeta(provider)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(config.model)
  const [baseURL, setBaseURL] = useState(config.baseURL)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState<{ success: boolean; text: string } | null>(null)
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [modelsTested, setModelsTested] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const modelsRef = useRef<HTMLElement>(null)
  const availableModels = Array.from(new Set(config.models))
  const filteredModels = availableModels.filter(id => `${id} ${modelLabel(id)}`.toLowerCase().includes(modelSearch.toLowerCase()))
  const showModels = (modelsTested || availableModels.length > 0) && status?.success !== false && !key.trim() && baseURL === config.baseURL
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    modalRef.current?.focus()
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() }
      if (e.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]')
        if (!focusable?.length) return
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener); previous?.focus() }
  }, [])
  useEffect(() => { setKey(''); setModel(config.model); setBaseURL(config.baseURL); setVisible(false); setStatus(null); setConfirmRemove(false); setModelsTested(false); setModelSearch('') }, [provider])
  useEffect(() => {
    if (modelsTested && status?.success) modelsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [modelsTested, status])
  const save = async (test = false) => {
    setBusy(test ? 'test' : 'save'); setStatus(null)
    if (key.trim() || baseURL !== config.baseURL) setModelsTested(false)
    try {
      const saved = await bridge.saveProvider(provider, { apiKey: key || undefined, model, baseURL })
      setKey('')
      const updated = { ...settings, providers: settings.providers.map(p => p.id === provider ? saved : p) }
      onUpdate(updated)
      if (test) {
        const result = await bridge.testProvider(provider)
        onUpdate({ ...updated, providers: updated.providers.map(p => p.id === provider ? { ...p, models: result.models } : p) })
        setModelSearch('')
        setModelsTested(true)
        setStatus({ success: true, text: `Verbindung steht. ${result.models.length} ${result.models.length === 1 ? 'Modell' : 'Modelle'} verfügbar.` })
      } else setStatus({ success: true, text: 'Einstellungen gespeichert.' })
    } catch (error) { setStatus({ success: false, text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Speichern fehlgeschlagen.' }) }
    finally { setBusy('') }
  }
  const changeSettings = async (patch: Partial<SettingsType>) => {
    try { onUpdate(await bridge.saveSettings(patch)) } catch (error) { notify(String(error)) }
  }
  const nav: { id: Section; label: string; icon: typeof KeyRound }[] = [
    { id: 'providers', label: 'Modelle & API-Keys', icon: KeyRound },
    { id: 'appearance', label: 'Erscheinungsbild', icon: Palette },
    { id: 'general', label: 'Arbeitsweise', icon: Settings2 },
    { id: 'about', label: 'Über Koda', icon: CircleHelp },
  ]
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={modalRef} tabIndex={-1}>
      <aside className="settings-nav"><h2 id="settings-title">Einstellungen</h2><div className="settings-nav-items">{nav.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><item.icon size={16}/>{item.label}</button>)}</div>
        <div className="settings-nav-bottom"><Mark size={21}/><span>Koda <small>Version {__APP_VERSION__}</small></span></div>
      </aside>
      <div className="settings-content">
        <button className="icon-button settings-close" aria-label="Einstellungen schließen" onClick={onClose}><X size={18}/></button>
        {section === 'providers' && <>
          <div className="section-heading"><span className="eyebrow">DEIN SETUP</span><h2>Deine Modelle.</h2><p>Verbinde deine Anbieter direkt mit Koda.</p></div>
          {!bridge.desktop && <div className="inline-notice"><Monitor size={16}/><span>Browser-Vorschau. API-Keys und Projektzugriff sind in der Desktop-App verfügbar.</span></div>}
          <div className="provider-tabs" role="tablist" aria-label="API-Anbieter">{PROVIDERS.map(p => <button key={p.id} role="tab" aria-selected={provider === p.id} className={provider === p.id ? 'active' : ''} onClick={() => setProvider(p.id)} disabled={!!busy}><ProviderIcon id={p.id} size={25}/><span>{p.id === 'custom' ? 'Eigener' : p.name}</span>{isConfigured(settings.providers.find(c => c.id === p.id)!) && <span className="connected-dot"/>}</button>)}</div>
          <div className="provider-heading"><div><h3>{meta.name}</h3><span>{meta.company}</span></div><span className={`connection-state ${isConfigured(config) ? 'connected' : ''}`}><span/>{isConfigured(config) ? 'Konfiguriert' : 'Nicht verbunden'}</span></div>
          <div className="form-field"><label htmlFor="api-key">API-Key {config.hasKey && <span className="field-badge"><ShieldCheck size={12}/> Verschlüsselt gespeichert</span>}{provider === 'custom' && !config.hasKey && <span className="field-optional">Optional für lokale Modelle</span>}</label><div className="password-field"><KeyRound size={16}/><input id="api-key" type={visible ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)} placeholder={config.hasKey ? '••••••••••••••••••••••••' : provider === 'custom' ? 'Optionaler API-Key' : 'Deinen API-Key einfügen'} autoComplete="off" spellCheck={false}/><button className="icon-button" title={visible ? 'Key verbergen' : 'Key anzeigen'} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><div className="field-help"><span>Der Key bleibt verschlüsselt auf deinem Gerät.</span>{meta.keyURL && <button className="text-link" onClick={() => void bridge.openExternal(meta.keyURL)}>API-Key erstellen <ArrowUpRight size={12}/></button>}</div></div>
          <div className="form-field"><label htmlFor="model-id">Modell-ID</label><input id="model-id" list={`models-${provider}`} value={model} onChange={e => setModel(e.target.value)} placeholder={provider === 'custom' ? 'z. B. qwen3-coder' : meta.model} spellCheck={false}/><datalist id={`models-${provider}`}>{config.models.map(m => <option key={m} value={m}/>)}</datalist><div className="field-help">Verbindung prüfen, um die Modelle deines Kontos zu laden. Eigene Modell-IDs sind möglich.</div></div>
          {provider === 'custom' && <div className="form-field"><label htmlFor="base-url">API-Endpoint</label><input id="base-url" value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false}/><div className="field-help">OpenAI-kompatible Chat-Completions-API. Unterstützt auch Ollama, LM Studio und OpenRouter.</div></div>}
          {status && <div className={`form-status ${status.success ? 'success' : 'error'}`} role="status">{status.success && <CheckCircle2 size={15}/>}<span>{status.text}</span></div>}
          <div className="provider-actions"><button className="button secondary" onClick={() => void save(true)} disabled={!!busy || !bridge.desktop || (!key && !config.hasKey && provider !== 'custom')}>{busy === 'test' ? <LoaderCircle size={14} className="spin"/> : <span className="test-dot"/>} Verbindung prüfen</button><button className="button primary" onClick={() => void save()} disabled={!!busy || !model.trim() || !bridge.desktop}>{busy === 'save' ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>} Speichern</button></div>
          {showModels && <section className="available-models" aria-labelledby="available-models-title" ref={modelsRef}>
            <div className="available-models-heading"><h4 id="available-models-title">Verfügbare Modelle</h4><span>{availableModels.length}</span></div>
            {availableModels.length > 8 && <input className="available-models-search" type="search" aria-label="Verfügbare Modelle durchsuchen" placeholder="Modelle durchsuchen …" value={modelSearch} onChange={event => setModelSearch(event.target.value)}/>}
            {availableModels.length > 0 ? <>
              <div className="available-models-list">{filteredModels.map(id => <button key={id} type="button" className={`available-model-option ${model === id ? 'selected' : ''}`} aria-pressed={model === id} disabled={!!busy} onClick={() => setModel(id)}>
                <span><strong>{modelLabel(id)}</strong>{modelLabel(id) !== id && <code>{id}</code>}</span>{model === id ? <Check size={14}/> : <span className="model-option-dot"/>}
              </button>)}{filteredModels.length === 0 && <p className="models-empty">Kein Modell für „{modelSearch}“ gefunden.</p>}</div>
              <p className="available-models-hint">{model !== config.model ? <><span>{modelLabel(model)}</span> ausgewählt. Mit „Speichern“ übernehmen.</> : 'Modell anklicken, um die Auswahl zu ändern.'}</p>
            </> : <p className="models-empty">Der Anbieter hat keine Modelle zurückgegeben. Du kannst die Modell-ID weiterhin manuell eintragen.</p>}
          </section>}
          {config.hasKey && <div className="remove-key-row">{confirmRemove ? <><span>Gespeicherten Key entfernen?</span><button className="text-link danger" disabled={!!busy} onClick={async () => { setBusy('remove'); try { const removed = await bridge.removeKey(provider); onUpdate({ ...settings, providers: settings.providers.map(p => p.id === provider ? removed : p) }); setConfirmRemove(false); setStatus(null); setModelsTested(false); setModelSearch('') } catch (error) { notify(String(error)) } finally { setBusy('') } }}>Entfernen</button><button className="text-link" onClick={() => setConfirmRemove(false)}>Abbrechen</button></> : <button className="text-link subtle" onClick={() => setConfirmRemove(true)}><Trash2 size={12}/> API-Key entfernen</button>}</div>}
          <div className="settings-note"><LockKeyhole size={16}/><p>Anfragen gehen direkt an den gewählten Anbieter. Koda betreibt keinen Zwischenserver. Die API-Nutzung wird über dein jeweiliges Konto abgerechnet.</p></div>
        </>}
        {section === 'appearance' && <><div className="section-heading"><span className="eyebrow">DEINE OBERFLÄCHE</span><h2>Erscheinungsbild</h2><p>Passe Koda an deinen Arbeitsplatz an.</p></div><h3 className="setting-label">Farbschema</h3><div className="theme-options">{([{ value: 'light', label: 'Hell', icon: Sun }, { value: 'dark', label: 'Dunkel', icon: Moon }, { value: 'system', label: 'System', icon: Laptop }] as { value: Theme; label: string; icon: typeof Sun }[]).map(item => <button key={item.value} className={`theme-option ${settings.theme === item.value ? 'active' : ''}`} onClick={() => void changeSettings({ theme: item.value })}><div className={`theme-preview ${item.value}`}><i/><div><b/><b/><b/></div></div><span><item.icon size={15}/>{item.label}{settings.theme === item.value && <Check size={14}/>}</span></button>)}</div><div className="setting-row"><div><h3>Schriftgröße im Chat</h3><p>Die Oberfläche bleibt kompakt.</p></div><select aria-label="Schriftgröße" value={settings.fontSize} onChange={e => void changeSettings({ fontSize: Number(e.target.value) })}>{[12, 13, 14, 15, 16, 17, 18].map(n => <option key={n} value={n}>{n} px</option>)}</select></div><div className="font-sample"><span>Aa</span><div>Inter & Instrument Serif<small>Schriftarten werden lokal geladen.</small></div></div></>}
        {section === 'general' && <><div className="section-heading"><span className="eyebrow">DEIN WORKFLOW</span><h2>Deine Arbeitsweise.</h2><p>Persönliche Vorgaben für alle neuen Anfragen.</p></div><div className="form-field"><label htmlFor="default-provider">Standardanbieter</label><select id="default-provider" value={settings.defaultProvider} onChange={e => void changeSettings({ defaultProvider: e.target.value as ProviderId })}>{PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="form-field"><label htmlFor="system-prompt">Eigene Anweisungen <span className="field-optional">Optional</span></label><textarea id="system-prompt" rows={7} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} maxLength={12000} placeholder={'Zum Beispiel:\nAntworte auf Deutsch. Verwende TypeScript und halte Änderungen klein.'}/><div className="field-help">Diese Anweisungen werden bei jeder Anfrage mitgesendet.</div></div><button className="button primary" onClick={async () => { await changeSettings({ systemPrompt }); notify('Arbeitsweise gespeichert.') }}><Check size={14}/> Anweisungen speichern</button><div className="settings-note"><ShieldCheck size={18}/><p>Unter dem Eingabefeld wählst du die Rechte für den Chat: „Nachfragen“ bestätigt Änderungen und Befehle einzeln; „Vollzugriff“ führt sie direkt aus. Der Fragen-Modus bleibt lesend.</p></div></>}
        {section === 'about' && <div className="about-content"><div className="about-mark"><Mark size={48}/></div><h2>Koda</h2><p>Dein Code. Dein Workspace.</p><span className="version-pill">Desktop · Version {__APP_VERSION__}</span><div className="about-details"><div><LockKeyhole size={18}/><span><strong>Auf deinem Gerät</strong>Projekte und Chatverlauf werden lokal gespeichert.</span></div><div><KeyRound size={18}/><span><strong>Mit deinen API-Keys</strong>Direkte Verbindung zu deinen Anbietern.</span></div><div><ChevronRight size={18}/><span><strong>Ein eigenständiger Client</strong>Unabhängig von Anthropic und anderen Anbietern.</span></div><UpdateSettings notify={notify}/></div></div>}
      </div>
    </div>
  </div>
}
