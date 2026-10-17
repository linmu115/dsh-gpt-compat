/** Explicit Responses server compaction. Opaque items never become visible text. */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Item } from './responses-wire.ts'

export function validateServerCompaction(item: Item): void {
  if (item.type !== 'compaction' || typeof item.encrypted_content !== 'string' || !item.encrypted_content.trim()
    || (item.id !== undefined && (typeof item.id !== 'string' || !item.id))
    || (item.status !== undefined && item.status !== 'completed')) {
    throw new LlmError('Invalid server compaction output', 'INVALID_RESPONSES_PAYLOAD')
  }
}

/** Optimize only a balanced cut. Keep full history if a retained result needs an earlier call. */
export function pruneServerInput(input: readonly Item[]): Item[] {
  let cut = -1
  const calls = new Map<string, number>()
  const results = new Set<string>()
  for (const [index, item] of input.entries()) {
    if (item.type === 'compaction') { validateServerCompaction(item); cut = index }
    if ((item.type === 'function_call' || item.type === 'custom_tool_call') && typeof item.call_id === 'string') calls.set(item.call_id, index)
    if ((item.type === 'function_call_output' || item.type === 'custom_tool_call_output') && typeof item.call_id === 'string') results.add(item.call_id)
  }
  if (cut < 0) return [...input]
  for (const [id, index] of calls) if (index < cut && !results.has(id)) return [...input]
  for (const item of input.slice(cut)) {
    if ((item.type === 'function_call_output' || item.type === 'custom_tool_call_output')
      && typeof item.call_id === 'string' && (calls.get(item.call_id) ?? cut) < cut) return [...input]
  }
  // Current instructions are supplied anew by the harness, outside opaque state.
  return [...input.slice(0, cut).filter(item => item.role === 'system' || item.role === 'developer'), ...input.slice(cut)]
}

export function serverContextManagement(threshold: number | undefined): Item[] {
  if (!Number.isSafeInteger(threshold) || threshold! <= 0) throw new LlmError('Server compaction requires a positive explicit threshold', 'INVALID_SERVER_COMPACTION_CONFIG')
  return [{ type: 'compaction', compact_threshold: threshold }]
}
