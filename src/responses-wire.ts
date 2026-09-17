/** Lossless Responses conversion; provider state is never placed in visible text. */
import { createHash } from 'node:crypto'
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ReplayEnvelope, TokenUsage } from '@deepseek-ai/dsh-llm'

export type Item = Record<string, unknown>
export const NATIVE_FORMAT = 'dsh-gpt-responses/v1'
export const record = (value: unknown): value is Item => typeof value === 'object' && value !== null && !Array.isArray(value)
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const invalid = (message: string): never => { throw new LlmError(message, 'INVALID_RESPONSES_PAYLOAD') }
const string = (value: unknown): string => typeof value === 'string' ? value : invalid('Responses field must be a string')

/** Validate executable output before exposing any tool call to the harness. */
export function blocksFromOutput(output: unknown): ContentBlock[] {
  if (!Array.isArray(output)) return invalid('Responses output must be an array')
  const blocks: ContentBlock[] = []
  const calls = new Set<string>()
  for (const item of output) {
    if (!record(item)) return invalid('Responses output item must be an object')
    switch (item.type) {
      case 'message': {
        if (item.role !== 'assistant' || !Array.isArray(item.content)) return invalid('Invalid assistant output')
        for (const part of item.content) {
          if (!record(part)) return invalid('Invalid assistant content')
          if (part.type === 'output_text') blocks.push({ type: 'text', text: string(part.text) })
          else if (part.type === 'refusal') blocks.push({ type: 'text', text: string(part.refusal) })
          else return invalid('Unsupported assistant content type')
        }
        break
      }
      case 'reasoning': {
        if (!Array.isArray(item.summary)) return invalid('Invalid reasoning summary')
        for (const part of item.summary) {
          if (!record(part) || part.type !== 'summary_text') return invalid('Invalid reasoning summary part')
          blocks.push({ type: 'reasoning', text: string(part.text) })
        }
        break
      }
      case 'function_call':
      case 'custom_tool_call': {
        if (item.status !== undefined && item.status !== 'completed') return invalid('Tool input is not complete')
        const id = string(item.call_id)
        if (!id || calls.has(id)) return invalid('Missing or duplicate tool call identity')
        calls.add(id)
        const name = string(item.name)
        if (item.type === 'custom_tool_call' && name !== 'apply_patch') return invalid('Unsupported custom tool')
        blocks.push({ type: 'tool-call', id: ToolCallId(id), name,
          arguments: item.type === 'custom_tool_call' ? JSON.stringify({ patch: string(item.input) }) : string(item.arguments) })
        break
      }
      default: return invalid(`Unsupported Responses output type: ${String(item.type)}`)
    }
  }
  // DSH drops empty text/reasoning blocks while assembling the durable message.
  return blocks.filter(block => block.type !== 'text' && block.type !== 'reasoning' || block.text.length > 0)
}

/** Replay is tied to an exact provider, model and endpoint, and to the stored visible blocks. */
export function replayEnvelope(output: Item[], responseId: string, origin: string, blocks: ContentBlock[]): ReplayEnvelope {
  return { response: { kind: 'dsh-gpt-responses', version: 1, origin, responseId,
    contentFingerprint: fingerprint(blocks), output: structuredClone(output) } }
}

/** Convert logged history without changing its content or executing historical calls. */
export function requestBody(options: GenerateOptions, origin: string, customApplyPatch: boolean): Item {
  const input: Item[] = []
  const calls = new Map<string, 'function_call' | 'custom_tool_call'>()
  const append = (items: Item[]) => {
    for (const item of items) {
      if (item.type === 'function_call' || item.type === 'custom_tool_call') {
        const id = string(item.call_id)
        if (calls.has(id)) return invalid('Duplicate historical tool call')
        calls.set(id, item.type)
      }
      input.push(item)
    }
  }
  if (options.system) input.push({ role: 'system', content: options.system })
  for (const message of options.messages) {
    const state = message.source.kind === 'model' ? message.source.replayState : undefined
    const replay = record(state) && record(state.response) ? state.response : undefined
    if (message.role === 'assistant' && replay?.kind === 'dsh-gpt-responses' && replay.version === 1
      && replay.origin === origin && replay.contentFingerprint === fingerprint(message.content)
      && Array.isArray(replay.output) && replay.output.every(record)) {
      // Revalidation also prevents malformed persisted state reaching the wire.
      if (fingerprint(blocksFromOutput(replay.output)) !== replay.contentFingerprint) return invalid('Replay content does not match the log')
      append(structuredClone(replay.output))
      continue
    }
    for (const block of message.content) {
      switch (block.type) {
        case 'text': input.push({ role: message.role, content: block.text }); break
        case 'reasoning': break // Foreign reasoning signatures and private state are not portable.
        case 'tool-call': {
          // Historical generic calls stay generic, even if today's tool declaration is custom.
          append([{ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments }])
          break
        }
        case 'tool-result': {
          const type = calls.get(block.toolCallId)
          if (!type) return invalid('Tool result has no preceding call in this context window')
          const text = block.content.map(part => part.type === 'text' ? part.text : invalid('Unsupported tool result content')).join('\n')
          input.push({ type: type === 'custom_tool_call' ? 'custom_tool_call_output' : 'function_call_output', call_id: block.toolCallId, output: text })
          break
        }
        default: return invalid('This Responses adapter currently accepts text and tool content only')
      }
    }
  }
  if (options.stop?.length) return invalid('Responses does not support stop sequences')
  const prefix = options.adapterContext
  if (prefix && (prefix.format !== NATIVE_FORMAT || prefix.scope !== origin || !prefix.input.every(record))) return invalid('Incompatible native context prefix')
  return {
    model: options.model, input: prefix
      ? [...input.filter(item => item.role === 'system'), ...structuredClone(prefix.input), ...input.filter(item => item.role !== 'system')]
      : input, store: false, stream: true, include: ['reasoning.encrypted_content'],
    ...options.tools?.length ? { tools: options.tools.map(tool => {
      const properties = tool.parameters.properties
      const patch = tool.name === 'apply_patch' && customApplyPatch && record(properties) && record(properties.patch) && properties.patch.type === 'string'
      return patch ? { type: 'custom', name: tool.name, description: tool.description, format: { type: 'text' } }
        : { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }
    }) } : {},
    ...options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens },
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    ...options.reasoningEffort === undefined ? {} : { reasoning: { effort: options.reasoningEffort } },
  }
}

/** Responses input counts include cached tokens; DSH's inputTokens excludes them. */
export function usageFromResponse(value: unknown): TokenUsage | undefined {
  if (value === undefined) return undefined
  if (!record(value)) return invalid('Invalid Responses usage')
  const number = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : invalid('Invalid token count')
  const input = number(value.input_tokens), output = number(value.output_tokens)
  const cached = record(value.input_tokens_details) ? number(value.input_tokens_details.cached_tokens ?? 0) : 0
  if (cached > input) return invalid('Cached input exceeds total input')
  const reasoning = record(value.output_tokens_details) ? value.output_tokens_details.reasoning_tokens : undefined
  return { inputTokens: input - cached, outputTokens: output, cacheReadTokens: cached,
    ...value.total_tokens === undefined ? {} : { totalTokens: number(value.total_tokens) },
    ...reasoning === undefined ? {} : { reasoningTokens: number(reasoning) } }
}
