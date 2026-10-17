import { expect, it } from 'vitest'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { blocksFromOutput, fingerprint, replayEnvelope, requestBody } from '../src/responses-wire.ts'
import { pruneServerInput, serverContextManagement } from '../src/responses-server-compaction.ts'
import type { Item } from '../src/responses-wire.ts'

const compaction = (id = 'one'): Item => ({ type: 'compaction', id, encrypted_content: 'opaque-' + id })
const text = (value = 'visible'): Item => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value }] })
const user = () => createUserMessage({ content: [{ type: 'text', text: 'old user input' }], source: { kind: 'user' } })
const options = { provider: 'test', model: 'model', messages: [] }

it('only explicitly enabled output accepts legal opaque compaction, with no visible leakage', () => {
  expect(() => blocksFromOutput([compaction(), text()])).toThrow('explicit server mode')
  expect(blocksFromOutput([compaction(), text()], true)).toEqual([{ type: 'text', text: 'visible' }])
  expect(blocksFromOutput([compaction()], true)).toEqual([])
  expect(() => blocksFromOutput([{ type: 'unknown', encrypted_content: 'opaque' }], true)).toThrow('Unsupported Responses')
})

it.each([{}, { encrypted_content: '' }, { encrypted_content: 1 }, { encrypted_content: 'opaque', id: 1 }, { encrypted_content: 'opaque', status: 'in_progress' }])('rejects malformed server item %j', value => {
  expect(() => blocksFromOutput([{ type: 'compaction', ...value }], true)).toThrow('Invalid server compaction')
})

it('preserves complete durable replay but sends the latest safe compaction and current instructions', () => {
  const output = [text('pre-cut'), compaction(), text()]
  const blocks = blocksFromOutput(output, true)
  const replay = replayEnvelope(output, 'resp', 'server-scope', blocks)
  const assistant = createAssistantMessage({ content: blocks, source: { kind: 'model', provider: 'test', model: 'model', replayState: replay } })
  const restored = JSON.parse(JSON.stringify(assistant))
  const request = requestBody({ ...options, system: 'current instructions', messages: [user(), restored] }, 'server-scope', true, true)
  expect(request.input).toEqual([{ role: 'system', content: 'current instructions' }, compaction(), text()])
  expect(restored.source.replayState.response.output).toEqual(output)
  expect(restored.source.replayState.response.contentFingerprint).toBe(fingerprint(blocks))
  expect(JSON.stringify(restored.content)).not.toContain('opaque-')
  const foreign = requestBody({ ...options, messages: [restored] }, 'other-scope', true, true)
  expect(JSON.stringify(foreign.input)).not.toContain('opaque-')
  restored.content[0].text = 'edited'
  expect(JSON.stringify(requestBody({ ...options, messages: [restored] }, 'server-scope', true, true).input)).not.toContain('opaque-')
})

it('revalidates stored opaque items and rejects a mismatched visible fingerprint', () => {
  const blocks = blocksFromOutput([text()], true)
  const replay = replayEnvelope([compaction(), text('changed')], 'resp', 'server-scope', blocks)
  const assistant = createAssistantMessage({ content: blocks, source: { kind: 'model', provider: 'test', model: 'model', replayState: replay } })
  expect(() => requestBody({ ...options, messages: [assistant] }, 'server-scope', true, true)).toThrow('Replay content does not match')
})

it('keeps a crossing tool pair intact and prunes completed pairs before a later checkpoint', () => {
  const call: Item = { type: 'custom_tool_call', call_id: 'patch', name: 'apply_patch', input: 'patch' }
  const result: Item = { type: 'custom_tool_call_output', call_id: 'patch', output: 'done' }
  const crossing = [{ role: 'system', content: 'current' }, call, compaction(), result]
  expect(pruneServerInput(crossing)).toEqual(crossing)
  expect(pruneServerInput([call, compaction()])).toEqual([call, compaction()])
  expect(pruneServerInput([...crossing, compaction('two'), text()])).toEqual([{ role: 'system', content: 'current' }, compaction('two'), text()])
  const blocks = blocksFromOutput([call, compaction()], true)
  const assistant = createAssistantMessage({ content: blocks, source: { kind: 'model', provider: 'test', model: 'model', replayState: replayEnvelope([call, compaction()], 'resp', 'server', blocks) } })
  const tool = createToolResultMessage({ callId: ToolCallId('patch'), isError: false, content: [{ type: 'text', text: 'done' }] })
  expect(requestBody({ ...options, messages: [assistant, tool] }, 'server', true, true).input).toEqual([call, compaction(), result])
})

it('requires explicit positive threshold and rejects local native prefixes in server mode', () => {
  expect(serverContextManagement(1000)).toEqual([{ type: 'compaction', compact_threshold: 1000 }])
  for (const value of [undefined, 0, -1, 1.5, Infinity]) expect(() => serverContextManagement(value)).toThrow('explicit threshold')
  expect(() => requestBody({ ...options, adapterContext: { format: 'dsh-gpt-responses/v1', scope: 'server', input: [] } }, 'server', true, true)).toThrow('local context prefix')
})
