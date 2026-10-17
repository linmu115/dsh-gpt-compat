import { afterEach, expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { PlainConfig, ResponsesAdapter } from '../src/responses.ts'
import { postStream } from '../src/responses-http.ts'
import { SseFrames } from '../src/responses-stream.ts'
import { completed, textItem, serve } from './responses-server.ts'
import type { Item } from '../src/responses-wire.ts'

afterEach(() => vi.unstubAllGlobals())
const frame = (event: Item) => `data: ${JSON.stringify(event)}\r\n\r\n`
const delta = (text: string, output = 0, part = 0): Item => ({ type: 'response.output_text.delta', output_index: output, content_index: part, item_id: 'msg_test', delta: text })
const terminal = (output: Item[]) => ({ type: 'response.completed', response: completed(output) })
const collect = async (stream: AsyncIterable<StreamChunk>) => { const chunks: StreamChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks }
function harness(contentType = 'text/event-stream', config: Item = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancelled = vi.fn()
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value }, cancel: cancelled })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': contentType } })))
  const profile = PlainConfig({ providers: { test: { baseURL: 'http://fixture.invalid/v1', apiKeyEnv: 'TEST', models: [{ id: 'model', contextWindow: 32000, maxTokens: 2000 }], ...config } } })
  const adapter = new ResponsesAdapter(() => profile, async () => 'synthetic-key')
  return { adapter, cancelled,
    push: (text: string) => controller.enqueue(Buffer.from(text)),
    bytes: (bytes: Uint8Array) => controller.enqueue(bytes),
    end: () => controller.close(),
    stream: (signal?: AbortSignal) => adapter.stream({ provider: 'test', model: 'model', messages: [], signal }),
  }
}

it('delivers text before terminal, reconciles once, and closes a retained keep-alive body', async () => {
  const h = harness(), iterator = h.stream()[Symbol.asyncIterator]()
  h.push(': keepalive\r\n\r\n' + frame(delta('你好')))
  expect((await iterator.next()).value).toMatchObject({ type: 'block-start', index: 0 })
  expect((await iterator.next()).value).toEqual({ type: 'text-delta', index: 0, text: '你好' })
  expect(h.cancelled).not.toHaveBeenCalled()
  h.push(frame(terminal([textItem('你好')])))
  const tail = await collect({ [Symbol.asyncIterator]: () => iterator })
  expect(tail.filter(value => value.type === 'text-delta')).toEqual([])
  expect(tail.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(h.cancelled).toHaveBeenCalledOnce()
})

it('decodes every-byte UTF-8 and CRLF splits without changing final text', async () => {
  const h = harness()
  const bytes = Buffer.from(frame(delta('🙂汉字')) + frame(terminal([textItem('🙂汉字')])))
  for (const byte of bytes) h.bytes(Uint8Array.of(byte))
  const chunks = await collect(h.stream())
  expect(chunks.filter(value => value.type === 'text-delta').map(value => value.text).join('')).toBe('🙂汉字')
  expect(chunks.filter(value => value.type === 'block-start')).toHaveLength(1)
})

it('frames CR, LF, comments, multi-line data, and a final frame without a separator', () => {
  const parser = new SseFrames()
  const result = [...parser.push(': comment\r'), ...parser.push('\ndata: {\rdata: "a":1}\n\n'), ...parser.push('data: final', true)]
  expect(result).toEqual(['{\n"a":1}', 'final'])
})

it('streams reasoning and multiple text/refusal blocks in canonical order', async () => {
  const h = harness()
  const reasoning = { type: 'reasoning', id: 'rs_test', summary: [{ type: 'summary_text', text: 'thinking' }] }
  const message = { ...textItem('answer'), content: [{ type: 'output_text', text: 'answer' }, { type: 'refusal', refusal: 'cannot' }] }
  h.push(frame({ type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, item_id: 'rs_test', delta: 'thinking' }))
  const iterator = h.stream()[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toMatchObject({ type: 'block-start', blockType: 'reasoning' })
  expect((await iterator.next()).value).toMatchObject({ type: 'reasoning-delta', text: 'thinking' })
  h.push(frame({ type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, item_id: 'rs_test', text: 'thinking' }) + frame({ type: 'response.output_item.done', output_index: 0, item: reasoning }))
  h.push(frame(delta('answer', 1)) + frame({ type: 'response.output_text.done', output_index: 1, content_index: 0, item_id: 'msg_test', text: 'answer' }))
  h.push(frame({ type: 'response.refusal.delta', output_index: 1, content_index: 1, item_id: 'msg_test', delta: 'cannot' }))
  expect((await iterator.next()).value).toMatchObject({ type: 'block-start', index: 1 })
  expect((await iterator.next()).value).toMatchObject({ type: 'text-delta', text: 'answer' })
  expect((await iterator.next()).value).toMatchObject({ type: 'block-start', index: 2 })
  expect((await iterator.next()).value).toMatchObject({ type: 'text-delta', text: 'cannot' })
  h.push(frame(terminal([reasoning, message])))
  const tail = await collect({ [Symbol.asyncIterator]: () => iterator })
  expect(tail.filter(value => value.type === 'block-end').map(value => value.index)).toEqual([0, 1, 2])
  expect(tail.some(value => value.type === 'text-delta' || value.type === 'reasoning-delta')).toBe(false)
})

it('holds a tool and subsequent text until all terminal tool fields are validated', async () => {
  const h = harness()
  const tool = { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'test_tool', arguments: '{}', status: 'completed' }
  h.push(frame({ type: 'response.output_item.added', output_index: 0, item: { ...tool, status: 'in_progress', arguments: '' } }) + frame(delta('after tool', 1)))
  h.push(frame(terminal([tool, textItem('after tool')])))
  const chunks = await collect(h.stream())
  expect(chunks.filter(value => value.type === 'block-start').map(value => value.blockType)).toEqual(['tool-call', 'text'])
  expect(chunks.filter(value => value.type === 'tool-call-delta')).toHaveLength(1)
})

it.each(['mismatch', 'missing', 'wrong-item', 'invalid-tool', 'failed', 'truncated', 'duplicate-terminal'] as const)('does not expose tools or finish after %s', async kind => {
  const h = harness()
  const tool = { type: 'function_call', call_id: 'call', name: 'test_tool', arguments: '{}', status: 'completed' }
  h.push(frame(delta('visible')))
  if (kind === 'failed') h.push(frame({ type: 'response.failed', response: { error: { code: 'test-failure' } } }))
  else if (kind === 'truncated') h.end()
  else {
    const text = kind === 'mismatch' ? 'different' : 'visible'
    const output = [kind === 'wrong-item' ? { ...textItem(text), id: 'wrong' } : textItem(text), kind === 'invalid-tool' ? { ...tool, status: 'in_progress' } : tool]
    const value = terminal(kind === 'missing' ? [tool] : output)
    h.push(frame(value) + (kind === 'duplicate-terminal' ? frame(value) : ''))
  }
  const chunks: StreamChunk[] = []
  await expect((async () => { for await (const chunk of h.stream()) chunks.push(chunk) })()).rejects.toThrow()
  expect(chunks.some(value => value.type === 'tool-call-delta' || value.type === 'finish')).toBe(false)
  if (kind !== 'truncated') expect(h.cancelled).toHaveBeenCalledOnce()
})

it('max-token incomplete closes validated text but never exposes partial tool input', async () => {
  const h = harness()
  h.push(frame(delta('partial')))
  h.push(frame({ type: 'response.incomplete', response: { ...completed([textItem('partial'), { type: 'function_call', arguments: '{', status: 'in_progress' }]), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }))
  const chunks = await collect(h.stream())
  expect(chunks.filter(value => value.type === 'text-delta')).toHaveLength(1)
  expect(chunks.some(value => value.type === 'tool-call-delta')).toBe(false)
  expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
})

it('supports plain JSON fallback with the same final block validation', async () => {
  const h = harness('application/json')
  h.push(JSON.stringify(completed([textItem('fallback')]))); h.end()
  const chunks = await collect(h.stream())
  expect(chunks.filter(value => value.type === 'text-delta')).toEqual([{ type: 'text-delta', index: 0, text: 'fallback' }])
})

it('consumer return cancels the reader before terminal', async () => {
  const h = harness()
  h.push(frame(delta('visible')))
  for await (const chunk of h.stream()) if (chunk.type === 'text-delta') break
  expect(h.cancelled).toHaveBeenCalledOnce()
})

it('cancellation between visible chunks prevents further output and cancels the reader', async () => {
  const h = harness(), controller = new AbortController()
  h.push(frame(delta('first')))
  const iterator = h.stream(controller.signal)[Symbol.asyncIterator]()
  await iterator.next(); await iterator.next()
  controller.abort(new Error('synthetic cancellation'))
  h.push(frame(terminal([textItem('first')])))
  await expect(iterator.next()).rejects.toThrow('synthetic cancellation')
  expect(h.cancelled).toHaveBeenCalledOnce()
})

it('enforces the byte limit before publishing a terminal result', async () => {
  const h = harness('text/event-stream', { maxResponseBytes: 16 })
  h.push(frame(terminal([textItem('too large')])) )
  await expect(collect(h.stream())).rejects.toMatchObject({ code: 'RESPONSES_SIZE_LIMIT' })
  expect(h.cancelled).toHaveBeenCalledOnce()
})

it('ignores provider error text and retains bounded error classification', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'usage_limit_reached', message: 'private provider details' } }), { status: 429 })))
  const packets = postStream({ baseURL: 'http://fixture.invalid', apiKey: 'synthetic', timeoutMs: 1000, maxResponseBytes: 1024 }, 'responses', { stream: true })
  await expect(packets.next()).rejects.toMatchObject({ message: 'Responses HTTP 429' })
})

it('uses the real HTTP reader to deliver a delta while the server deliberately withholds terminal', async () => {
  let response!: ServerResponse
  let closed!: () => void
  const disconnected = new Promise<void>(resolve => { closed = resolve })
  const server = await serve((_body, value) => {
    response = value
    value.once('close', closed)
    value.writeHead(200, { 'content-type': 'text/event-stream' })
    value.write(frame(delta('network first')))
  })
  try {
    const config = PlainConfig({ providers: { test: { baseURL: server.url, apiKeyEnv: 'TEST', models: [{ id: 'model', contextWindow: 32000, maxTokens: 2000 }] } } })
    const adapter = new ResponsesAdapter(() => config, async () => 'synthetic-key')
    const iterator = adapter.stream({ provider: 'test', model: 'model', messages: [] })[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ type: 'block-start' })
    expect((await iterator.next()).value).toMatchObject({ type: 'text-delta', text: 'network first' })
    expect(response.writableEnded).toBe(false)
    response.write(frame(terminal([textItem('network first')])))
    const tail = await collect({ [Symbol.asyncIterator]: () => iterator })
    expect(tail.at(-1)).toMatchObject({ type: 'finish' })
    await disconnected
  } finally { await server.close() }
})

it('rejects a terminal with an out-of-order sequence number before tools', async () => {
  const h = harness()
  h.push(frame({ ...delta('first'), sequence_number: 4 }))
  h.push(frame({ ...terminal([textItem('first')]), sequence_number: 3 }))
  await expect(collect(h.stream())).rejects.toMatchObject({ code: 'INVALID_RESPONSES_PAYLOAD' })
})

it('honors cancellation between block-start and the delta from the same parsed event', async () => {
  const h = harness(), controller = new AbortController()
  h.push(frame(delta('must not be emitted')))
  const iterator = h.stream(controller.signal)[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toMatchObject({ type: 'block-start' })
  controller.abort(new Error('cancel between chunks'))
  await expect(iterator.next()).rejects.toThrow('cancel between chunks')
  expect(h.cancelled).toHaveBeenCalledOnce()
})

it('buffers out-of-order output positions until their preceding visible block is known', async () => {
  const h = harness()
  h.push(frame(delta('second', 1)))
  h.push(frame(delta('first')) + frame({ type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: 'msg_test', text: 'first' }))
  h.push(frame({ type: 'response.output_item.done', output_index: 0, item: textItem('first') }))
  h.push(frame(terminal([textItem('first'), textItem('second')])))
  const chunks = await collect(h.stream())
  expect(chunks.filter(value => value.type === 'text-delta').map(value => value.text)).toEqual(['first', 'second'])
  expect(chunks.filter(value => value.type === 'block-end').map(value => value.index)).toEqual([0, 1])
})

it.each(['half-json', 'half-utf8'] as const)('does not turn post-terminal %s bytes into a synthetic EOF event', async kind => {
  const h = harness()
  const suffix = kind === 'half-json' ? Buffer.from('data: {"type":"response.') : Buffer.from([0xe4, 0xb8])
  h.bytes(Buffer.concat([Buffer.from(frame(terminal([textItem('complete')]))), suffix]))
  // Deliberately leave the body open. The complete terminal owns the result;
  // an incomplete suffix is neither a complete conflicting frame nor EOF.
  const chunks = await collect(h.stream())
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(h.cancelled).toHaveBeenCalledOnce()
})
