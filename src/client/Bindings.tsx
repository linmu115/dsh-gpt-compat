import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'

export interface Binding { provider: string; models: string[] }
export interface BindingSettings { bindings: Binding[] }
export interface Face {
  hooks: { bindings: SettingsScope<BindingSettings> }
  save: (bindings: Binding[], revision: number) => Promise<void>
}
export type Props = PropsRuntime<'settings.models.footer'> & PropsLocale<'gpt.compat'> & InjectFace<Face>

/** Edits a local draft against its original revision; pushed changes cannot silently overwrite it. */
export function Bindings(props: Props) {
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
  return <section aria-label={t('title')} style={{ marginTop: 24, display: 'grid', gap: 12 }}>
    <h3>{t('title')}</h3>
    <p>{t('description')}</p>
    {snapshot.status !== 'ready' && <p role="status">{t('unavailable')}</p>}
    {rows.map((row, index) => <fieldset key={index} disabled={!writable} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <legend>{t('binding')} {index + 1}</legend>
      <label>{t('provider')}<input aria-label={`${t('provider')} ${index + 1}`} value={row.provider}
        onChange={event => edit(rows.map((r, i) => i === index ? { ...r, provider: event.target.value } : r))} /></label>
      <label>{t('models')}<input aria-label={`${t('models')} ${index + 1}`} value={row.models.join(', ')}
        onChange={event => edit(rows.map((r, i) => i === index ? { ...r, models: event.target.value.split(',').map(model => model.trim()) } : r))} /></label>
      <button type="button" onClick={() => edit(rows.filter((_, i) => i !== index))}>{t('remove')}</button>
    </fieldset>)}
    {!rows.length && snapshot.status === 'ready' && <p>{t('disabled')}</p>}
    <p>{t('hint')}</p>
    {error && <p role="alert">{error}</p>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" disabled={!writable} onClick={() => edit([...rows, { provider: '', models: ['gpt-*'] }])}>{t('add')}</button>
      <button type="button" disabled={!writable || !draft || revision === undefined} onClick={async () => {
        if (!draft || revision === undefined) return
        setSaving(true)
        try { await props.save(draft, revision); setDraft(undefined); setError('') }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setSaving(false) }
      }}>{saving ? t('saving') : t('save')}</button>
      <button type="button" disabled={saving || !draft} onClick={() => { setDraft(undefined); setError('') }}>{t('discard')}</button>
    </div>
  </section>
}
