import { afterEach, expect, it, vi } from 'vitest'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Config, ResponsesAdapter } from '../src/responses.ts'
import { imagePart, hydrateImages } from '../src/responses-images.ts'
import { requestBody } from '../src/responses-wire.ts'
import { estimateNativeTokens, codexCompactionWindow } from '../src/native-budget.ts'
import { portableTokens } from '../src/context.ts'
import { serve, completed, sse, textItem } from './responses-server.ts'

const ref = { attachmentId: 'synthetic', mediaType: 'image/png', bytes: 3, width: 100, height: 100 } as ImageAttachmentRef
const data = new Uint8Array([1, 2, 3])
const user = () => createUserMessage({ source: { kind: 'user' }, content: [
  { type: 'text', text: 'before' }, { type: 'image', attachment: ref }, { type: 'text', text: 'after' },
] })
const options = () => ({ provider: 'test', model: 'gpt-test', messages: [user()] })
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
const drain = async (stream: AsyncIterable<unknown>) => { for await (const _ of stream) { /* exhaust */ } }

it('preserves image order and resolves bytes only at transport, including nested tool results', async () => {
  const id = ToolCallId('call-image')
  const request = { ...options(), messages: [user(), createAssistantMessage({ source: { kind: 'model', provider: 'test', model: 'gpt-test' },
    content: [{ type: 'tool-call', id, name: 'screenshot', arguments: '{}' }] }),
    createUserMessage({ source: { kind: 'tool', callId: id }, content: [{ type: 'tool-result', toolCallId: id,
      content: [{ type: 'text', text: 'screen' }, { type: 'image', attachment: ref }] }] })] }
  const body = requestBody(request, 'origin', false)
  const saved = JSON.stringify(body)
  const read = vi.fn(async () => ({ ref, data }))
  const resolved = await hydrateImages(body, read, 100000)
  expect(read).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(resolved.body)).not.toContain('dsh_attachment')
  expect(JSON.stringify(resolved.body).match(/data:image\/png;base64,AQID/g)).toHaveLength(2)
  expect(JSON.stringify(body)).toBe(saved)
  expect(resolved.restore(resolved.body.input as Record<string, unknown>[])).toEqual(body.input)
})

it('prices visual content without charging its base64 as text, for native and portable budgets', () => {
  const small = requestBody(options(), 'origin', false)
  const largeBytes = structuredClone(small)
  ;((largeBytes.input as any[])[1].content[0].dsh_attachment).bytes = 4000000
  expect(estimateNativeTokens(small, 1.5)).toBe(estimateNativeTokens(largeBytes, 1.5))
  expect(estimateNativeTokens(small, 1)).toBeGreaterThan(4096)
  expect(portableTokens([user()])).toBeGreaterThan(4096)
})

it('refuses missing storage, invalid references, cancellation and oversized images before sending', async () => {
  const body = requestBody(options(), 'origin', false)
  await expect(hydrateImages(body, undefined, 100000)).rejects.toThrow('storage')
  const read = vi.fn(async () => ({ ref, data }))
  await expect(hydrateImages(body, read, 1)).rejects.toThrow('byte limit')
  expect(read).not.toHaveBeenCalled()
  const abort = new AbortController(); abort.abort()
  await expect(hydrateImages(body, read, 100000, abort.signal)).rejects.toThrow()
  expect(() => imagePart({ ...ref, width: NaN })).toThrow('reference')
  expect(() => codexCompactionWindow(body.input as any[], { status: 'incomplete', output: [] })).toThrow()
  expect(JSON.stringify(body)).toContain('dsh_attachment')
})

it.each(['codex-v2', 'responses'] as const)('sends images through generation, %s compaction and restored continuation', async mode => {
  const server = await serve((body, response, path) => {
    if (path.endsWith('input_tokens')) { response.end(JSON.stringify({ input_tokens: 5000 })); return }
    const compact = path.endsWith('/compact') || JSON.stringify(body).includes('compaction_trigger')
    const checkpoint = { type: 'compaction', encrypted_content: 'summary-of-image' }
    sse(response, completed(compact ? mode === 'responses' ? [...body.input as any[], checkpoint] : [checkpoint] : [textItem('ok')]))
  })
  cleanup.push(server.close)
  const config = Config({ providers: { test: { baseURL: server.url, apiKeyEnv: 'TEST_KEY', nativeContextMode: mode,
    models: [{ id: 'gpt-test', contextWindow: 64000, maxTokens: 2000 }] } } })
  const adapter = new ResponsesAdapter(() => config, async () => 'fixture-key', undefined, undefined, async () => ({ ref, data }))
  expect((await adapter.resolveModel('test', 'gpt-test')).inputModalities).toContain('image')
  expect(adapter.imageRequestPricing('test', 'gpt-test').priceImages([ref])[0]?.visualTokens).toBe(4096)
  await drain(adapter.stream(options()))
  const prepared = await adapter.prepareCall('test', 'gpt-test')
  const cap = prepared.nativeContext!
  const encoded = cap.encode([user()])
  expect(await cap.count(options(), encoded)).toBeGreaterThan(4096)
  const prefix = await cap.compact(options(), encoded)
  const restored = JSON.parse(JSON.stringify(prefix))
  await drain(prepared.stream({ ...options(), messages: [], adapterContext: { format: cap.format, scope: cap.scope, input: restored } }))
  expect(JSON.stringify(prefix)).not.toContain('base64')
  expect(JSON.stringify(server.requests[0]?.body)).toContain('data:image/png;base64,AQID')
  const compact = server.requests.find(r => r.path.endsWith('/compact') || JSON.stringify(r.body).includes('compaction_trigger'))!
  expect(JSON.stringify(compact.body)).toContain('data:image/png;base64,AQID')
  expect(JSON.stringify(server.requests.at(-1)?.body)).toContain('summary-of-image')
  expect(JSON.stringify(prefix).includes('dsh_attachment')).toBe(mode === 'responses')
  expect(JSON.stringify(encoded)).toContain('dsh_attachment')
})
