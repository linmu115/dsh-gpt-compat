import { expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage } from '@deepseek-ai/dsh-session/surface'
import { compactionResult, readCompactionUsage, sanitizeUsage, summarizeAuxiliaryUsage } from '../src/auxiliary-usage.ts'
import { selectContext } from '../src/context.ts'
import { Config } from '../src/config.ts'

it('keeps unknown counts unknown and strips payloads instead of manufacturing zeroes', () => {
  expect(sanitizeUsage({ inputTokens: 0, outputTokens: 3, totalTokens: -1, reasoningTokens: NaN, key: 'PRIVATE' })).toEqual({
    accounting: 'auxiliary', inputTokens: 0, outputTokens: 3, totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null,
  })
  expect(readCompactionUsage(['OLD_PRIVATE_INPUT']).inputTokens).toBeNull()
  expect(readCompactionUsage({ type: 'gpt-compat.compaction-result', version: 2, usage: { inputTokens: 123 } }).inputTokens).toBeNull()
})

it('rebuilds auxiliary totals after JSON persistence without double counting duplicate results or inline usage', () => {
  const events = [
    { type: 'context/operation-result', data: { operation: 1, output: compactionResult(['OPAQUE'], { inputTokens: 10, outputTokens: 2 }) } },
    { type: 'context/operation-result', data: { operation: 2, output: { type: 'gpt-compat.compaction-result', version: 1, usage: sanitizeUsage({ inputTokens: 500, outputTokens: 5 }, 'included-in-response') } } },
    { type: 'assistant/message', data: { usage: { inputTokens: 9000 } } },
  ]
  const result = summarizeAuxiliaryUsage(JSON.parse(JSON.stringify([...events, events[0]])))
  expect(result.operations).toBe(1)
  expect(result.totals).toMatchObject({ inputTokens: 10, outputTokens: 2, totalTokens: null })
  expect(JSON.stringify(result)).not.toContain('OPAQUE')
  expect(summarizeAuxiliaryUsage([...events, { type: 'context/operation-result', data: { operation: 3, output: 'old summary' } }]).totals.inputTokens).toBeNull()
})

function fixture(native = true) {
  const messages = ['a'.repeat(600), 'b'.repeat(600), 'latest'].map(text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  const events: any[] = messages.map((data, seq) => ({ type: 'user/message', seq, data, time: seq }))
  const session = { surface: { nodes: [0, 1, 2] }, snapshotEvents: () => events, deriveEventMessage,
    append: (type: string, data: unknown) => { const event = { type, seq: events.length, data }; events.push(event); return event } }
  const config = Config({ bindings: native ? [{ provider: 'p', models: ['m'] }] : [], context: {
    enabled: true, triggerRatio: 0.8, reserveTokens: 100, marginTokens: 0, retainGroups: 1, summaryMaxTokens: 100,
  } })
  const capability = { format: 'native', scope: 'p/m', encode: (items: any[]) => items.map(m => ({ text: m.content[0].text })),
    count: vi.fn(async (_: unknown, items: any[]) => items.reduce((sum, item) => sum + item.text.length, 0)),
    compact: vi.fn(async () => [{ text: 'short' }]),
    compactWithUsage: vi.fn(async () => ({ input: [{ text: 'short' }], usage: { inputTokens: 20, outputTokens: 3 }, accounting: 'auxiliary' as const })),
  }
  return { messages, events, session, config, capability, request: { provider: 'p', model: 'm', maxTokens: 100, messages } }
}

it('records native usage in a versioned result while leaving checkpoint input and projection compatible', async () => {
  const f = fixture()
  const projection = await selectContext({ sessions: { flush: async () => true } } as any, { session: f.session } as any,
    f.request, { context: { contextWindow: 1000 }, nativeContext: f.capability } as any, f.config)
  expect(f.capability.compact).not.toHaveBeenCalled()
  expect(f.capability.compactWithUsage).toHaveBeenCalled()
  const result = f.events.find(e => e.type === 'context/operation-result')
  expect(readCompactionUsage(result.data.output).inputTokens).toBe(20)
  expect(projection.adapterContext?.input).toEqual([{ text: 'short' }])
  expect(f.events.find(e => e.type === 'context/checkpoint').data.state.version).toBe(1)
  expect(JSON.stringify(f.events.find(e => e.type === 'context/checkpoint'))).not.toContain('inputTokens')
})

it('preserves a legacy native compact implementation and records its usage as unknown', async () => {
  const f = fixture(); delete (f.capability as any).compactWithUsage
  await selectContext({ sessions: { flush: async () => true } } as any, { session: f.session } as any,
    f.request, { context: { contextWindow: 1000 }, nativeContext: f.capability } as any, f.config)
  expect(f.capability.compact).toHaveBeenCalled()
  expect(summarizeAuxiliaryUsage(f.events).totals.inputTokens).toBeNull()
})

it('captures only the latest cumulative portable summary usage once per auxiliary request', async () => {
  const f = fixture(false)
  const stream = vi.fn(async function* () {
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 1 } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
    yield { type: 'block-end', block: { type: 'text', text: 'short' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const ctx = { sessions: { flush: async () => true }, llm: { prepareCall: async () => ({ context: { contextWindow: 5000 }, config: {}, stream }) } }
  await selectContext(ctx as any, { session: f.session } as any, f.request, { context: { contextWindow: 1000 } } as any, f.config)
  expect(stream).toHaveBeenCalled()
  const result = f.events.find(e => e.type === 'context/operation-result')
  expect(result.data.output.result).toBe('short')
  expect(readCompactionUsage(result.data.output)).toMatchObject({ inputTokens: 10, outputTokens: 2 })
})

it('server-managed mode uses original history and drops an earlier projection without local compaction', async () => {
  const f = fixture()
  const result = await selectContext({} as any, { session: f.session } as any,
    { ...f.request, adapterContext: { format: 'old', scope: 'old', input: ['old checkpoint'] } },
    { nativeContext: { ...f.capability, serverManaged: true } } as any, f.config)
  expect(result).toEqual({ messages: f.messages })
  expect(f.capability.count).not.toHaveBeenCalled()
  expect(f.capability.compactWithUsage).not.toHaveBeenCalled()
  expect(f.events).toHaveLength(3)
})
