/** Opt-in Codex-style budget estimate. This is neither a tokenizer nor billable usage. */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { record, type Item } from './responses-wire.ts'

// Reference: openai/codex 787823cf, core/src/context_manager/history.rs.
// Encrypted reasoning/compaction framing is estimated there as base64 bytes minus 650.
// Keep the protocol assumption isolated; a provider change can invalidate it.
export function estimateNativeTokens(body: Item, multiplier: number): number {
  let opaqueBytes = 0
  const input = Array.isArray(body.input) ? body.input.map(item => {
    if (!record(item) || !['reasoning', 'compaction', 'compaction_summary'].includes(String(item.type)) || item.encrypted_content === undefined) return item
    if (typeof item.encrypted_content !== 'string') throw new LlmError('Invalid opaque context for estimation', 'INVALID_TOKEN_COUNT')
    opaqueBytes += Math.max(0, Math.floor(item.encrypted_content.length * 3 / 4) - 650)
    return { ...item, encrypted_content: '' }
  }) : body.input
  const visible = JSON.stringify({ ...body, input })
  const tokens = Math.ceil((Buffer.byteLength(visible, 'utf8') + opaqueBytes) / 4 * multiplier)
  if (!Number.isSafeInteger(tokens)) throw new LlmError('Native context estimate exceeded range', 'INVALID_TOKEN_COUNT')
  return tokens
}

/** V2 emits a compaction item; preserve original user inputs as Codex does for text history. */
export function codexCompactionWindow(input: Item[], response: Item): Item[] {
  if (response.status !== 'completed' || !Array.isArray(response.output)
    || response.output.length !== 1 || !record(response.output[0])
    || !['compaction', 'compaction_summary'].includes(String(response.output[0].type))
    || typeof response.output[0].encrypted_content !== 'string' || !response.output[0].encrypted_content) {
    throw new LlmError('Codex compaction did not return one complete encrypted checkpoint', 'INVALID_COMPACTION')
  }
  // No truncation of retained user text. The controller fails if it cannot fit the budget.
  const retained = input.filter(item => item.role === 'user' || item.role === 'developer')
  return structuredClone([...retained, { ...response.output[0], type: 'compaction' }])
}
