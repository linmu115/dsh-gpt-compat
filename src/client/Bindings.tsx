import { useId, useState } from 'react'
import { Button, Input, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { Accounts } from './Accounts.tsx'

export interface Binding { provider: string; models: string[] }
export interface BindingSettings { bindings: Binding[] }
export interface Face {
  hooks: { bindings: SettingsScope<BindingSettings> }
  save: (bindings: Binding[], revision: number) => Promise<void>
}
export type Props = PropsRuntime<'settings.models.footer'> & PropsLocale<'gpt.compat'> & InjectFace<Face>

/** Edits a local draft against its original revision; pushed changes cannot silently overwrite it. */
export function Bindings(props: Props) {
  const id = useId()
  const snapshot = props.useBindings(value => value)
  const [draft, setDraft] = useState<Binding[]>()
  const [revision, setRevision] = useState<number>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const rows = draft ?? snapshot.value?.bindings ?? []
  const edit = (next: Binding[]) => {
    if (!draft) setRevision(snapshot.revision)
    setDraft(next)
    setError('')
  }
  const writable = snapshot.status === 'ready' && snapshot.writable && !saving
  const { t } = props
  return <><section aria-labelledby={`${id}-title`} className="gpt-compat-settings" aria-busy={saving}>
    <header className="gpt-compat-settings__heading">
      <h3 id={`${id}-title`}>{t('title')}</h3>
      <p className="gpt-compat-settings__intro">{t('description')}</p>
    </header>
    {snapshot.status !== 'ready' && <p className="gpt-compat-settings__notice" role="status">{t('unavailable')}</p>}
    <div className="gpt-compat-settings__bindings">
      {rows.map((row, index) => <div key={index} role="group" aria-labelledby={`${id}-binding-${index}`} className="gpt-compat-settings__card">
        <div className="gpt-compat-settings__card-heading">
          <h4 id={`${id}-binding-${index}`}>{t('binding')} {index + 1}</h4>
          <Button size="sm" disabled={!writable} className="gpt-compat-settings__remove"
            onClick={() => edit(rows.filter((_, i) => i !== index))}>{t('remove')}</Button>
        </div>
        <label className="gpt-compat-settings__field">
          <span>{t('provider')}</span>
          <Input aria-label={`${t('provider')} ${index + 1}`} className="gpt-compat-settings__input" disabled={!writable}
            autoComplete="off" spellCheck={false} value={row.provider}
            onChange={event => edit(rows.map((r, i) => i === index ? { ...r, provider: event.target.value } : r))} />
        </label>
        <label className="gpt-compat-settings__field">
          <span>{t('models')}</span>
          <textarea aria-label={`${t('models')} ${index + 1}`} aria-describedby={`${id}-hint`} disabled={!writable}
            className="gpt-compat-settings__models" rows={3} spellCheck={false} value={row.models.join(', ')}
            onChange={event => edit(rows.map((r, i) => i === index ? { ...r, models: event.target.value.split(',').map(model => model.trim()) } : r))} />
        </label>
      </div>)}
    </div>
    {!rows.length && snapshot.status === 'ready' && <p className="gpt-compat-settings__empty">{t('disabled')}</p>}
    <p id={`${id}-hint`} className="gpt-compat-settings__hint">{t('hint')}</p>
    {error && <p className="gpt-compat-settings__error" role="alert">{error}</p>}
    <div className="gpt-compat-settings__actions">
      <Button variant="outline" disabled={!writable} icon={<IconPlusOutline16 size={16} />}
        onClick={() => edit([...rows, { provider: '', models: ['gpt-*'] }])}>{t('add')}</Button>
      <div className="gpt-compat-settings__commit">
      <Button variant="outline" disabled={saving || !draft} onClick={() => { setDraft(undefined); setError('') }}>{t('discard')}</Button>
      <Button variant="primary" disabled={!writable || !draft || revision === undefined} onClick={async () => {
        if (!draft || revision === undefined) return
        setSaving(true)
        try { await props.save(draft, revision); setDraft(undefined); setError('') }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setSaving(false) }
      }}>{saving ? t('saving') : t('save')}</Button>
      </div>
    </div>
  </section><Accounts t={t} /></>
}
