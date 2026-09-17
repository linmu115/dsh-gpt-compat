import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Accounts } from './Accounts.tsx'

export interface ProviderSettings { providers: Record<string, unknown> }
export interface ModelGroup { id: string; name: string; models: readonly { id: string; name: string }[] }
export interface Face {
  hooks: { providers: SettingsScope<ProviderSettings> }
  loadModels: (providers: string[]) => Promise<readonly ModelGroup[]>
}
export type Props = PropsRuntime<'settings.section'> & PropsLocale<'gpt.compat'> & InjectFace<Face>

/** Read-only discovery. Model selection belongs to the conversation. */
export function Bindings(props: Props) {
  const id = useId(), snapshot = props.useProviders(value => value)
  const providers = JSON.stringify(Object.keys(snapshot.value?.providers ?? {}).sort())
  const [groups, setGroups] = useState<readonly ModelGroup[]>([])
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(false)
  const load = useRef(props.loadModels); load.current = props.loadModels
  useEffect(() => {
    let active = true
    setGroups([]); setError(false); setLoading(true)
    if (snapshot.status !== 'ready') { setLoading(false); return }
    load.current(JSON.parse(providers)).then(value => { if (active) setGroups(value) }, () => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [providers, snapshot.status, refresh])
  const { t } = props
  return <><section aria-labelledby={`${id}-title`} className="gpt-compat-settings" aria-busy={loading}>
    <header className="gpt-compat-settings__heading">
      <div className="gpt-compat-settings__card-heading"><h3 id={`${id}-title`}>{t('title')}</h3>
        <Button variant="outline" size="sm" disabled={loading || snapshot.status !== 'ready'} onClick={() => setRefresh(value => value + 1)}>{t('refreshModels')}</Button></div>
      <p className="gpt-compat-settings__intro">{t('description')}</p>
    </header>
    {snapshot.status !== 'ready' ? <p role="status">{t('unavailable')}</p>
      : loading ? <p role="status" className="gpt-compat-settings__hint">{t('loadingModels')}</p>
      : error ? <p role="alert" className="gpt-compat-settings__error">{t('failedModels')}</p>
      : groups.some(group => group.models.length) ? <div className="gpt-compat-settings__bindings">{groups.map(group => <div key={group.id} className="gpt-compat-settings__card">
        <h4>{group.name}</h4>
        <ul className="gpt-compat-settings__catalog">{group.models.map(model => <li key={model.id}>{model.name}</li>)}</ul>
      </div>)}</div> : <p role="status" className="gpt-compat-settings__empty">{t('emptyModels')}</p>}
    <p className="gpt-compat-settings__hint">{t('hint')}</p>
  </section><Accounts t={t} onChanged={() => setRefresh(value => value + 1)} /></>
}
