import { expect, it } from 'vitest'
import { SubmissionProgress } from '../src/progress.ts'
import { Config } from '../src/config.ts'

const config = Config({ bindings: [{ provider: 'cpa', models: ['gpt-*'] }], context: { enabled: true } })
const agent = (id = 'a', model = 'gpt-test') => ({ id, options: { provider: 'cpa', model }, session: { snapshotEvents: () => [] } }) as any
it('shows a preview before compaction, isolates sessions, and replaces it after durable submission', () => {
  const owner = new SubmissionProgress(() => config), a = agent()
  const handle = owner.begin(a, { clientSubmissionId: 'one', text: 'original input' })!
  expect(owner.read('a')).toMatchObject({ phase: 'preparing', preview: true, text: 'original input' })
  expect(owner.read('other')).toBeUndefined()
  expect(owner.begin(a, { clientSubmissionId: 'duplicate', text: 'other' })).toBeUndefined()
  handle.update('compressing', 2)
  expect(owner.read('a')).toMatchObject({ phase: 'compressing', pass: 2 })
  handle.finish({ kind: 'success', userMessageId: 'accepted' })
  expect(owner.read('a')).toMatchObject({ phase: 'sent', preview: false })
  expect(owner.active.size).toBe(0)
})
it('retains failed input and allows a subsequent retry; unrelated models do not participate', () => {
  const owner = new SubmissionProgress(() => config), a = agent()
  owner.begin(a, { clientSubmissionId: 'one', text: 'keep me' })!.finish({ kind: 'error', message: 'budget unavailable' })
  expect(owner.read('a')).toMatchObject({ phase: 'failed', preview: true, error: 'budget unavailable', text: 'keep me' })
  expect(owner.begin(a, { clientSubmissionId: 'retry', text: 'keep me' })).toBeDefined()
  expect(owner.begin(agent('other', 'ordinary'), { clientSubmissionId: 'x', text: '' })).toBeUndefined()
})
