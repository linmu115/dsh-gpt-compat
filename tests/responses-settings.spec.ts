import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { MemorySettings } from '@dsh-test/memory-settings'
import * as Responses from '../src/responses.ts'
import { serve, sse, completed, textItem } from './responses-server.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('applies settings to the next request, preserves a prepared request, and removes provider registration on disposal', async () => {
  const first = await serve((_body, response) => sse(response, completed([textItem('first')]))), second = await serve((_body, response) => sse(response, completed([textItem('second')])))
  cleanup.push(first.close, second.close)
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { TEST_KEY: 'test-key' } }]))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  const config = Responses.Config({ providers: { cpa: { baseURL: first.url, apiKeyEnv: 'TEST_KEY', models: [{ id: 'gpt-test', contextWindow: 32000, maxTokens: 2000 }] } } })
  const fiber = ctx.plugin(Responses, config)
  await fiber
  const prepared = await ctx.llm.prepareCall({ provider: 'cpa', model: 'gpt-test' })
  await ctx.settings.update('gpt-responses', { providers: { cpa: { baseURL: second.url } } })
  for await (const _chunk of prepared.stream({ ...prepared.config, messages: [] })) { /* consume */ }
  for await (const _chunk of ctx.llm.stream({ provider: 'cpa', model: 'gpt-test', messages: [] })) { /* consume */ }
  expect(first.requests).toHaveLength(1)
  expect(second.requests).toHaveLength(1)
  await expect(ctx.settings.update('gpt-responses', { providers: { cpa: { models: [{ id: 'gpt-test', contextWindow: 100, maxTokens: 100 }] } } })).rejects.toThrow()
  expect((await ctx.llm.prepareCall({ provider: 'cpa', model: 'gpt-test' })).context?.contextWindow).toBe(32000)
  expect(ctx.llm.listConfigurableProviders()).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'cpa', settingsNs: 'gpt-responses' })]))
  ctx.llm.registerAdapter(['foreign'], new Responses.ResponsesAdapter(() => config, async () => 'test-key'))
  await expect(ctx.settings.update('gpt-responses', { providers: { foreign: config.providers.cpa } })).rejects.toThrow('another adapter')
  expect((ctx.settings.get('gpt-responses') as Responses.Config).providers.foreign).toBeUndefined()
  await fiber.dispose()
  await expect(ctx.llm.prepareCall({ provider: 'cpa', model: 'gpt-test' })).rejects.toThrow('no adapter')
  expect(ctx.llm.listConfigurableProviders().some(provider => provider.provider === 'cpa')).toBe(false)
})
