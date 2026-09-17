import { expect, it } from 'vitest'
import { Config, matches, withNativeBindings } from '../src/config.ts'
import { ResponsesAdapter, type Config as ResponsesConfig } from '../src/responses.ts'

it('automatically enables new GPT models only for this adapter and preserves explicit foreign bindings', () => {
  const config = Config({ bindings: [{ provider: 'cpa', models: ['gpt-old'] }, { provider: 'manual', models: ['gpt-exact'] }] })
  const effective = withNativeBindings(config, [{ provider: 'cpa', settingsNs: 'gpt-responses' }, { provider: 'foreign', settingsNs: 'another' }])
  expect(matches(effective, 'cpa', 'gpt-new')).toBe(true)
  expect(matches(effective, 'foreign', 'gpt-new')).toBe(false)
  expect(matches(effective, 'manual', 'gpt-exact')).toBe(true)
  expect(matches(withNativeBindings(config, []), 'cpa', 'gpt-new')).toBe(false)
  expect(config.bindings[0]!.models).toEqual(['gpt-old'])
})

it('uses discovered capabilities beyond the old configured list and freezes a prepared call', async () => {
  const configured: ResponsesConfig = { providers: { cpa: {
    baseURL: 'http://127.0.0.1:8317/v1', apiKeyEnv: 'TEST', models: [{ id: 'gpt-old', contextWindow: 32000, maxTokens: 2000 }],
    customApplyPatch: true, timeoutMs: 30000, maxResponseBytes: 100000, maxRequestBytes: 100000, nativeContextMode: 'codex-v2', tokenEstimateMultiplier: 1.5,
  } } }
  let models = [{ id: 'gpt-new', contextWindow: 921000, maxTokens: 128000, reasoningEfforts: ['low', 'high'] }]
  let fail = false
  const adapter = new ResponsesAdapter(() => configured, async () => 'test-key', undefined, async () => {
    if (fail) throw new Error('discovery failed')
    return models
  })
  expect((await adapter.listModels('cpa')).map(model => model.id)).toEqual(['gpt-new'])
  const prepared = await adapter.prepareCall('cpa', 'gpt-new')
  expect(prepared.model.context.contextWindow).toBe(921000)
  models[0]!.reasoningEfforts = ['low']
  expect(prepared.model.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high'])
  models = []
  expect(await adapter.listModels('cpa')).toEqual([])
  await expect(adapter.resolveModel('cpa', 'gpt-old')).rejects.toThrow()
  fail = true
  await expect(adapter.listModels('cpa')).rejects.toThrow('discovery failed')
})
