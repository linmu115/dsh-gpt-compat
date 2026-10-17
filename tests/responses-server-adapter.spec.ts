import { afterEach, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { PlainConfig, ResponsesAdapter, validateConfig } from '../src/responses.ts'
import type { NativeContextExtras } from '../src/auxiliary-usage.ts'
import { completed, serve, sse, textItem } from './responses-server.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
const config = (baseURL: string) => PlainConfig({ providers: { native: { baseURL, apiKeyEnv: 'TEST_KEY', nativeContextMode: 'responses-server', serverCompactionThreshold: 1000, models: [{ id: 'test', contextWindow: 32000, maxTokens: 2048 }] } } })
const request = () => ({ provider: 'native', model: 'test', system: 'current instructions', messages: [createUserMessage({ content: [{ type: 'text', text: 'history' }], source: { kind: 'user' } })] })
const collect = async (stream: AsyncIterable<StreamChunk>) => { const output: StreamChunk[] = []; for await (const chunk of stream) output.push(chunk); return output }

it('explicitly sends server context_management and persists opaque replay alongside matched visible blocks', async () => {
  const output = [{ type: 'compaction', id: 'cp', encrypted_content: 'opaque' }, textItem('done')]
  const server = await serve((_body, response) => sse(response, completed(output)))
  cleanup.push(server.close)
  const configured = config(server.url); validateConfig(configured)
  const adapter = new ResponsesAdapter(() => configured, async () => 'test-key')
  const prepared = await adapter.prepareCall('native', 'test')
  expect((prepared.nativeContext as NativeContextExtras).serverManaged).toBe(true)
  await expect(prepared.nativeContext!.count(request(), [])).rejects.toMatchObject({ code: 'SERVER_MANAGED_CONTEXT' })
  await expect(prepared.nativeContext!.compact(request(), [])).rejects.toMatchObject({ code: 'SERVER_MANAGED_CONTEXT' })
  await expect(adapter.compact('native', 'test', [])).rejects.toMatchObject({ code: 'SERVER_MANAGED_CONTEXT' })
  expect(server.requests).toHaveLength(0)
  const chunks = await collect(prepared.stream(request()))
  const blocks = chunks.flatMap(chunk => chunk.type === 'block-end' ? [chunk.block] : [])
  const finish = chunks.at(-1)
  const state = finish?.type === 'finish' ? finish.replayState : undefined
  expect(state?.response).toMatchObject({ output })
  expect(blocks).toEqual([{ type: 'text', text: 'done' }])
  const assistant = createAssistantMessage({ content: blocks, source: { kind: 'model', provider: 'native', model: 'test', replayState: state } })
  await collect(adapter.stream({ ...request(), messages: [...request().messages, JSON.parse(JSON.stringify(assistant))] }))
  expect(server.requests).toHaveLength(2)
  expect(server.requests[0]!.body).toMatchObject({ store: false, stream: true, context_management: [{ type: 'compaction', compact_threshold: 1000 }] })
  expect(server.requests[1]!.body.input).toEqual([{ role: 'system', content: 'current instructions' }, ...output])
  expect(server.requests.every(entry => entry.path === '/v1/responses')).toBe(true)
})

it('freezes mode and threshold in each prepared call and separates all three replay scopes', async () => {
  const server = await serve((_body, response) => sse(response, completed([textItem('done')])))
  cleanup.push(server.close)
  const configured = config(server.url)
  const adapter = new ResponsesAdapter(() => configured, async () => 'key')
  const first = await adapter.prepareCall('native', 'test')
  configured.providers.native!.serverCompactionThreshold = 2000
  const second = await adapter.prepareCall('native', 'test')
  await collect(first.stream(request())); await collect(second.stream(request()))
  expect(server.requests.map(entry => entry.body.context_management)).toEqual([[{ type: 'compaction', compact_threshold: 1000 }], [{ type: 'compaction', compact_threshold: 2000 }]])
  delete configured.providers.native!.serverCompactionThreshold
  configured.providers.native!.nativeContextMode = 'responses'
  const ordinary = await adapter.prepareCall('native', 'test')
  configured.providers.native!.nativeContextMode = 'codex-v2'
  const codex = await adapter.prepareCall('native', 'test')
  expect(new Set([first.nativeContext!.scope, ordinary.nativeContext!.scope, codex.nativeContext!.scope]).size).toBe(3)
})

it('rejects pure compaction terminal without fabricating visible success or retrying', async () => {
  const server = await serve((_body, response) => sse(response, completed([{ type: 'compaction', encrypted_content: 'opaque' }])))
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'key')
  const seen: StreamChunk[] = []
  await expect((async () => { for await (const chunk of adapter.stream(request())) seen.push(chunk) })()).rejects.toMatchObject({ code: 'COMPACTION_ONLY_RESPONSE' })
  expect(seen.some(chunk => chunk.type === 'finish' || chunk.type === 'block-end')).toBe(false)
  expect(server.requests).toHaveLength(1)
})

it('requires a mode-specific threshold below the declared input budget', () => {
  const configured = config('http://127.0.0.1/v1')
  validateConfig(configured)
  delete configured.providers.native!.serverCompactionThreshold
  expect(() => validateConfig(configured)).toThrow('threshold')
  configured.providers.native!.serverCompactionThreshold = 30000
  expect(() => validateConfig(configured)).toThrow('threshold')
  configured.providers.native!.serverCompactionThreshold = 1000
  configured.providers.native!.nativeContextMode = 'responses'
  expect(() => validateConfig(configured)).toThrow('server mode')
})
