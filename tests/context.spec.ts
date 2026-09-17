import { expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { balancedGroups, portableTokens } from '../src/context.ts'

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
