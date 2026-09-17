import { expect, it } from 'vitest'
import { codexCompactionWindow, estimateNativeTokens } from '../src/native-budget.ts'

it('budgets visible Unicode, tools and opaque framing without treating tool schemas as ciphertext', () => {
  const body = { model: 'fixture', input: [{ role: 'user', content: '中文' }, { type: 'compaction', encrypted_content: 'a'.repeat(2000) }], tools: [{ parameters: { properties: { encrypted_content: { type: 'string' } } } }] }
  const visible = { ...body, input: [body.input[0], { type: 'compaction', encrypted_content: '' }] }
  const expected = Math.ceil((Buffer.byteLength(JSON.stringify(visible)) + 850) / 4 * 1.5)
  expect(estimateNativeTokens(body, 1.5)).toBe(expected)
  expect(estimateNativeTokens({ ...body, tools: [] }, 1.5)).toBeLessThan(expected)
  expect(estimateNativeTokens(body, 2)).toBeGreaterThan(expected)
  expect(estimateNativeTokens({ input: [{ type: 'compaction', encrypted_content: 'tiny' }] }, 1)).toBeGreaterThan(0)
})

it('retains user requirements across repeated v2 compaction without duplicating old checkpoints', () => {
  const user = { role: 'user', content: 'Preserve this exact requirement.' }
  const first = codexCompactionWindow([user, { role: 'assistant', content: 'old details' }], { status: 'completed', output: [{ type: 'compaction', encrypted_content: 'first' }] })
  const second = codexCompactionWindow([...first, { type: 'function_call', call_id: 'c', name: 'f', arguments: '{}' }, { type: 'function_call_output', call_id: 'c', output: 'done' }], { status: 'completed', output: [{ type: 'compaction_summary', encrypted_content: 'second' }] })
  expect(second).toEqual([user, { type: 'compaction', encrypted_content: 'second' }])
  expect(first[1]?.encrypted_content).toBe('first')
})

it.each([
  { status: 'incomplete', output: [{ type: 'compaction', encrypted_content: 'partial' }] },
  { status: 'completed', output: [{ type: 'message', content: [] }] },
  { status: 'completed', output: [{ type: 'compaction', encrypted_content: '' }] },
  { status: 'completed', output: [{ type: 'compaction', encrypted_content: 'a' }, { type: 'custom_tool_call', name: 'apply_patch' }] },
])('rejects unusable v2 checkpoints without publishing tool output: %j', response => {
  expect(() => codexCompactionWindow([], response)).toThrow('complete encrypted checkpoint')
})
