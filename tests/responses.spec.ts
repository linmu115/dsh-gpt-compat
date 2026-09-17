import { afterEach, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Config, ResponsesAdapter, validateConfig } from '../src/responses.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { requestBody } from '../src/responses-wire.ts'
import type { Item } from '../src/responses-wire.ts'
import { completed, serve, sse, textItem } from './responses-server.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
const tools = [{ name: 'apply_patch', description: 'Apply a patch', parameters: { type: 'object', properties: { patch: { type: 'string' } }, required: ['patch'] } }]
const message = () => createUserMessage({ content: [{ type: 'text', text: '编辑文件' }], source: { kind: 'user' } })
const options = (): GenerateOptions => ({ provider: 'cpa', model: 'gpt-test', messages: [message()], tools })
const collect = async (stream: AsyncIterable<StreamChunk>) => { const result: StreamChunk[] = []; for await (const chunk of stream) result.push(chunk); return result }
function config(url: string) { return Config({ providers: { cpa: { baseURL: url, apiKeyEnv: 'TEST_KEY', models: [{ id: 'gpt-test', contextWindow: 32000, maxTokens: 2000 }] } } }) }

it('separates native replay scopes by CPA account and freezes account identity for each prepared call', async () => {
  const server = await serve((_body, response) => sse(response, completed([textItem('done')])))
  cleanup.push(server.close)
  let identity = 'account-a'
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key', async () => identity)
  const first = await adapter.prepareCall('cpa', 'gpt-test')
  identity = 'account-b'
  const second = await adapter.prepareCall('cpa', 'gpt-test')
  expect(first.nativeContext!.scope).not.toBe(second.nativeContext!.scope)
  await collect(first.stream(options()))
  await collect(second.stream(options()))
  expect(server.requests.map(r => r.headers['x-cpa-codex-account'])).toEqual(['account-a', 'account-b'])
})

it('publishes per-model reasoning choices and preserves the selected effort on the wire', async () => {
  const server = await serve((_body, response) => sse(response, completed([textItem('done')])))
  cleanup.push(server.close)
  const configured = config(server.url)
  Object.assign(configured.providers.cpa!.models[0]!, { reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'low' })
  validateConfig(configured)
  const adapter = new ResponsesAdapter(() => configured, async () => 'test-key')
  const prepared = await adapter.prepareCall('cpa', 'gpt-test')
  expect(prepared.model.reasoning).toEqual({ efforts: ['low', 'high', 'max'].map(id => ({ id, name: id })), defaultEffort: 'low' })
  configured.providers.cpa!.models[0]!.reasoningEfforts = ['low']
  expect(prepared.model.reasoning!.efforts.map(effort => effort.id)).toEqual(['low', 'high', 'max'])
  await collect(prepared.stream({ ...options(), reasoningEffort: ReasoningEffortId('high') }))
  expect(server.requests[0]!.body.reasoning).toEqual({ effort: 'high' })
  expect((await new ResponsesAdapter(() => config(server.url), async () => 'test-key').resolveModel('cpa', 'gpt-test')).reasoning).toBeUndefined()
})

it.each([
  { reasoningEfforts: ['low', 'low'] },
  { reasoningEfforts: [' low'] },
  { reasoningEfforts: ['low'], defaultReasoningEffort: 'ultra' },
  { defaultReasoningEffort: 'high' },
])('rejects invalid reasoning configuration %j', declaration => {
  const configured = config('http://localhost:8317/v1')
  Object.assign(configured.providers.cpa!.models[0]!, declaration)
  expect(() => validateConfig(configured)).toThrow('Invalid reasoning effort declaration')
})

it('uses explicitly selected Codex v2 compaction and local budget without probing legacy endpoints', async () => {
  const server = await serve((_body, response) => sse(response, completed([{ type: 'compaction', encrypted_content: 'native-checkpoint' }])))
  cleanup.push(server.close)
  const configured = config(server.url)
  configured.providers.cpa!.nativeContextMode = 'codex-v2'
  const adapter = new ResponsesAdapter(() => configured, async () => 'test-key')
  const prepared = await adapter.prepareCall('cpa', 'gpt-test')
  const capability = prepared.nativeContext!
  const input = capability.encode([message()])
  const count = await capability.count(options(), input)
  expect(count).toBeGreaterThan(0)
  expect(server.requests).toHaveLength(0)
  // A settings change cannot change an already prepared compaction protocol.
  configured.providers.cpa!.nativeContextMode = 'responses'
  const prefix = await capability.compact(options(), input)
  expect(prefix).toEqual([...input, { type: 'compaction', encrypted_content: 'native-checkpoint' }])
  expect(server.requests).toHaveLength(1)
  expect(server.requests[0]!.path).toBe('/v1/responses')
  expect(server.requests[0]!.body).toMatchObject({ stream: true, store: false, tools: [{ type: 'custom', name: 'apply_patch' }], input: [...input, { type: 'compaction_trigger' }] })
  const legacy = await adapter.prepareCall('cpa', 'gpt-test')
  expect(legacy.nativeContext!.scope).not.toBe(capability.scope)
})

it('round-trips native custom calls, encrypted reasoning, response identities and cache usage', async () => {
  const output: Item[] = [
    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-secret' },
    { type: 'custom_tool_call', id: 'ct_1', call_id: 'call_patch', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: a\n+好\n*** End Patch', status: 'completed' },
  ]
  const server = await serve((_body, response) => sse(response, completed(output)))
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key')
  const chunks = await collect(adapter.stream(options()))
  expect(server.requests[0]?.body).toMatchObject({ store: false, include: ['reasoning.encrypted_content'], tools: [{ type: 'custom', name: 'apply_patch', format: { type: 'text' } }] })
  expect(server.requests[0]?.headers['user-agent']).toMatch(/^deepseek-harness\//)
  expect(server.requests[0]?.headers.authorization).toBe('Bearer test-key')
  expect(chunks.find(chunk => chunk.type === 'usage')).toMatchObject({ usage: { inputTokens: 60, cacheReadTokens: 40, outputTokens: 20, totalTokens: 120, reasoningTokens: 5 } })
  const blocks = chunks.flatMap(chunk => chunk.type === 'block-end' ? [chunk.block] : [])
  const finish = chunks.at(-1)
  expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  const replay = finish?.type === 'finish' ? finish.replayState : undefined
  const assistant = createAssistantMessage({ content: blocks, source: { kind: 'model', provider: 'cpa', model: 'gpt-test', replayState: replay } })
  const result = createUserMessage({ content: [{ type: 'tool-result', toolCallId: ToolCallId('call_patch'), content: [{ type: 'text', text: 'done' }] }], source: { kind: 'tool', callId: ToolCallId('call_patch') } })
  // JSON persistence/reload must retain exactly the same provider output items.
  await collect(adapter.stream({ ...options(), messages: [message(), JSON.parse(JSON.stringify(assistant)), result] }))
  expect(server.requests[1]?.body.input).toEqual([{ role: 'user', content: '编辑文件' }, ...output, { type: 'custom_tool_call_output', call_id: 'call_patch', output: 'done' }])
  expect(JSON.stringify(assistant.content)).not.toContain('opaque-secret')
  const portable = requestBody({ ...options(), messages: [assistant, result] }, 'different-account-or-model', true)
  expect(JSON.stringify(portable)).not.toContain('opaque-secret')
  expect(portable.input).toEqual([{ type: 'function_call', call_id: 'call_patch', name: 'apply_patch', arguments: JSON.stringify({ patch: output[1]!.input }) }, { type: 'function_call_output', call_id: 'call_patch', output: 'done' }])
})

it('keeps complete compact windows without changing the input', async () => {
  const output = [{ role: 'user', content: 'retained' }, { type: 'compaction', encrypted_content: 'opaque', id: 'cmp_1' }]
  const server = await serve((_body, response, path) => path === '/v1/responses/compact'
    ? response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ output }))
    : response.writeHead(404).end())
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key')
  expect((await adapter.compact('cpa', 'gpt-test', [{ role: 'user', content: 'raw' }])).output).toEqual(output)
  expect(server.requests[0]?.body).toEqual({ model: 'gpt-test', input: [{ role: 'user', content: 'raw' }] })
})

it('fails once on an unsupported compact endpoint without falling back to ordinary generation', async () => {
  const server = await serve((_body, response) => response.writeHead(404).end())
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key')
  await expect(adapter.compact('cpa', 'gpt-test', [])).rejects.toThrow('HTTP 404')
  expect(server.requests).toHaveLength(1)
  expect(server.requests[0]!.path).toBe('/v1/responses/compact')
})

it.each([
  [400, 'context_length_exceeded', 'CONTEXT_WINDOW_EXCEEDED'],
  [429, 'rate_limit_exceeded', 'RATE_LIMIT'],
  [429, 'insufficient_quota', 'QUOTA'],
] as const)('classifies HTTP %i / %s without echoing provider error bodies', async (status, code, expected) => {
  const server = await serve((_body, response) => response.writeHead(status, { 'retry-after': '2' }).end(JSON.stringify({ error: { code, message: 'secret-echo' } })))
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key')
  await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: expected, failure: { status, providerRetryAfterMs: 2000 }, message: `Responses HTTP ${status}` })
})

it('classifies CPA usage_limit_reached as quota exhaustion rather than transient throttling', async () => {
  const server = await serve((_body, response) => response.writeHead(429).end(JSON.stringify({ error: { type: 'usage_limit_reached', message: 'private response body' } })))
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key')
  await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: 'QUOTA', message: 'Responses HTTP 429' })
  expect(server.requests).toHaveLength(1)
})

it.each([404, 501])('reports an unavailable native counter on HTTP %i without generating a replacement request', async status => {
  const server = await serve((_body, response) => response.writeHead(status).end())
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key')
  const prepared = await adapter.prepareCall('cpa', 'gpt-test')
  await expect(prepared.nativeContext!.count(options(), [])).rejects.toMatchObject({ code: 'NATIVE_COUNT_UNAVAILABLE' })
  expect(server.requests).toHaveLength(1)
})

it('freezes endpoint/key references across prepare and refuses unsupported stop controls', async () => {
  const first = await serve((_body, response) => sse(response, completed([textItem('first')]))), second = await serve((_body, response) => sse(response, completed([textItem('second')])))
  cleanup.push(first.close, second.close)
  let current = config(first.url)
  const keys: string[] = []
  const adapter = new ResponsesAdapter(() => current, async profile => { keys.push(profile.apiKeyEnv); return 'test-key' })
  const prepared = await adapter.prepareCall('cpa', 'gpt-test')
  current = config(second.url); current.providers.cpa!.apiKeyEnv = 'NEW_KEY'
  await collect(prepared.stream(options()))
  await collect(adapter.stream(options()))
  expect(keys).toEqual(['TEST_KEY', 'NEW_KEY'])
  expect(first.requests).toHaveLength(1); expect(second.requests).toHaveLength(1)
  await expect(collect(adapter.stream({ ...options(), stop: ['stop'] }))).rejects.toThrow('stop sequences')
  expect(second.requests).toHaveLength(1)
})

it.each(['truncated', 'duplicate-call', 'unknown-custom', 'over-limit', 'incomplete'] as const)('does not expose executable tools on %s output', async failure => {
  const call = { type: 'custom_tool_call', call_id: 'c1', name: failure === 'unknown-custom' ? 'unknown' : 'apply_patch', input: 'partial' }
  const server = await serve((_body, response) => {
    if (failure === 'truncated') { response.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: {"type":"response.output_item.done"}\n\n'); return }
    const result = completed(failure === 'duplicate-call' ? [call, call] : [call])
    if (failure === 'incomplete') Object.assign(result, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
    sse(response, result)
  })
  cleanup.push(server.close)
  const current = config(server.url)
  if (failure === 'over-limit') current.providers.cpa!.maxResponseBytes = 20
  const adapter = new ResponsesAdapter(() => current, async () => 'test-key')
  const seen: StreamChunk[] = []
  try { for await (const chunk of adapter.stream(options())) seen.push(chunk) } catch (error) { expect(failure).not.toBe('incomplete'); expect(error).toBeInstanceOf(Error) }
  expect(seen.some(chunk => chunk.type === 'block-end')).toBe(false)
  if (failure === 'incomplete') expect(seen.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'max-tokens' } })
  else expect(seen).toHaveLength(0)
})

it('cancels a hanging HTTP response and rejects malformed compact output', async () => {
  let entered!: () => void
  const received = new Promise<void>(resolve => { entered = resolve })
  const server = await serve((_body, response, path) => {
    if (path.endsWith('/compact')) response.writeHead(200).end('{"output":[]}')
    else { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders(); entered() }
  })
  cleanup.push(server.close)
  const adapter = new ResponsesAdapter(() => config(server.url), async () => 'test-key')
  const cancel = new AbortController()
  const pending = collect(adapter.stream({ ...options(), signal: cancel.signal }))
  const rejected = expect(pending).rejects.toThrow()
  await received; cancel.abort(); await rejected
  await expect(adapter.compact('cpa', 'gpt-test', [])).rejects.toThrow('complete encrypted window')
})
