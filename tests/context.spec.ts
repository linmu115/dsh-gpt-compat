import { expect, it, vi } from 'vitest'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { balancedGroups, portableTokens, selectContext } from '../src/context.ts'
import { Config } from '../src/config.ts'

const call = (id: string) => ({ type: 'tool-call' as const, id: ToolCallId(id), name: 'fixture', arguments: '{}' })
const result = (id: string) => createUserMessage({ content: [{ type: 'tool-result', toolCallId: ToolCallId(id), content: [{ type: 'text', text: 'done' }] }], source: { kind: 'tool', callId: ToolCallId(id) } })

it('keeps parallel calls and all results in one indivisible group', () => {
  const assistant = createAssistantMessage({ content: [call('a'), call('b')], source: { kind: 'model', provider: 'p', model: 'm' } })
  expect(balancedGroups([assistant, result('b'), result('a')])).toHaveLength(1)
  expect(() => balancedGroups([assistant, result('a')])).toThrow('unfinished')
  expect(() => balancedGroups([result('a')])).toThrow('Unpaired')
})

it('excludes replay metadata from the portable text budget', () => {
  const message = createAssistantMessage({ content: [{ type: 'text', text: 'readable' }], source: { kind: 'model', provider: 'p', model: 'm' } })
  const withPrivateMetadata = JSON.parse(JSON.stringify(message))
  withPrivateMetadata.source.replayState = { response: { encrypted_content: 'x'.repeat(1_000_000) } }
  expect(portableTokens([withPrivateMetadata])).toBe(portableTokens([message]))
})


it('never includes the current user input or its injected reference in a compaction request', async () => {
  const user = (text: string, source: any = { kind: 'user' }) => createUserMessage({ content: [{ type: 'text', text }], source })
  const current = user('CURRENT_INPUT'), reference = user('REFERENCE_ORIGINAL', { kind: 'dsh-annotation', targetUserMessageId: current.id })
  const messages = [user('a'.repeat(600)), user('b'.repeat(600)), current, reference]
  const events: any[] = messages.map((data, seq) => ({ type: 'user/message', seq, data }))
  const session = { surface: { nodes: [0, 1, 2, 3] }, snapshotEvents: () => events,
    append: (type: string, data: unknown) => { const event = { type, seq: events.length, data }; events.push(event); return event } }
  const compact = vi.fn(async (_request: unknown, input: unknown[]) => [{ text: 'summary' }])
  const capability = { format: 'native', scope: 'route', encode: (items: any[]) => items.map(m => ({ text: m.content[0].text })),
    count: async (_request: unknown, input: any[]) => input.reduce((n, item) => n + item.text.length, 0), compact }
  const config = Config({ bindings: [{ provider: 'test', models: ['model'] }], context: { enabled: true, triggerRatio: 0.8,
    reserveTokens: 100, marginTokens: 0, retainGroups: 1 } })
  const projection = await selectContext({ sessions: { flush: async () => true } } as any, { session } as any,
    { provider: 'test', model: 'model', maxTokens: 100, messages }, { context: { contextWindow: 1000 }, nativeContext: capability } as any, config)
  expect(compact).toHaveBeenCalled()
  expect(JSON.stringify(compact.mock.calls)).not.toMatch(/CURRENT_INPUT|REFERENCE_ORIGINAL/)
  expect(projection.messages.slice(-2)).toEqual([current, reference])
  expect(projection.adapterContext?.input).toEqual([{ text: 'summary' }])
})


it('compacts a completed previous turn during preflight without including the pending draft', async () => {
  const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  const old = user('OLD_INPUT'), pending = user('PENDING_INPUT')
  const assistant = (text: string) => createAssistantMessage({ content: [{ type: 'text', text }], source: { kind: 'model', provider: 'test', model: 'model' } })
  const messages = [old, assistant('x'.repeat(600)), assistant('y'.repeat(600)), assistant('done')]
  const events: any[] = messages.map((message, seq) => ({ type: message.role + '/message', seq, data: message.role === 'assistant' ? { message } : message }))
  const session = { surface: { nodes: [0, 1, 2, 3] }, snapshotEvents: () => events,
    append: (type: string, data: unknown) => { const event = { type, seq: events.length, data }; events.push(event as any); return event } }
  const compact = vi.fn(async (_request: unknown, _input: unknown[]) => [{ text: 'summary' }])
  const capability = { format: 'native', scope: 'route', encode: (items: any[]) => items.map(m => ({ text: m.content[0].text })),
    count: async (_request: unknown, input: any[]) => input.reduce((n, item) => n + item.text.length, 0), compact }
  const config = Config({ bindings: [{ provider: 'test', models: ['model'] }], context: { enabled: true, triggerRatio: 0.8,
    reserveTokens: 100, marginTokens: 0, retainGroups: 1 } })
  const projection = await selectContext({ sessions: { flush: async () => true } } as any, { session } as any,
    { provider: 'test', model: 'model', maxTokens: 100, messages: [...messages, pending] },
    { context: { contextWindow: 1000 }, nativeContext: capability } as any, config)
  expect(compact).toHaveBeenCalled()
  expect(JSON.stringify(compact.mock.calls)).not.toContain('PENDING_INPUT')
  expect(projection.messages).not.toContainEqual(pending)
  expect(projection.adapterContext?.input).toEqual([{ text: 'summary' }])
})
