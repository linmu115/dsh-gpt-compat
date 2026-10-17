import type { GenerateOptions, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Plugin-only extension; the host compact() contract and V4 event catalog stay unchanged. */
export interface NativeContextExtras {
  serverManaged?: boolean
  compactWithUsage?(options: GenerateOptions, input: JsonValue[]): Promise<{ input: JsonValue[]; usage?: TokenUsage; accounting: 'auxiliary' }>
}
export const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const
export type UsageField = typeof usageFields[number]
export type AuxiliaryUsage = { accounting: 'auxiliary' | 'included-in-response' } & Record<UsageField, number | null>
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Unknown is explicit. Never copy provider metadata, prices, payloads, or invented zeroes. */
export function sanitizeUsage(value: unknown, accounting: AuxiliaryUsage['accounting'] = 'auxiliary'): AuxiliaryUsage {
  const input = object(value) ? value : {}
  return { accounting, ...Object.fromEntries(usageFields.map(key => [key,
    typeof input[key] === 'number' && Number.isSafeInteger(input[key]) && input[key] >= 0 ? input[key] : null,
  ])) } as AuxiliaryUsage
}
export function compactionResult(result: JsonValue, usage?: unknown): JsonValue {
  return { type: 'gpt-compat.compaction-result', version: 1, result, usage: sanitizeUsage(usage) } as unknown as JsonValue
}
export function readCompactionUsage(output: unknown): AuxiliaryUsage {
  if (!object(output) || output.type !== 'gpt-compat.compaction-result' || output.version !== 1 || !object(output.usage)) return sanitizeUsage(undefined)
  return sanitizeUsage(output.usage, output.usage.accounting === 'included-in-response' ? 'included-in-response' : 'auxiliary')
}
/** Rebuild from durable result events; ordinary generation/inline compaction never enters extra totals. */
export function summarizeAuxiliaryUsage(events: readonly { type: string; data: unknown }[]): { operations: number; totals: Record<UsageField, number | null> } {
  const seen = new Set<number>(), rows: AuxiliaryUsage[] = []
  for (const event of events) {
    if (event.type !== 'context/operation-result' || !object(event.data) || !Number.isSafeInteger(event.data.operation)) continue
    const id = event.data.operation as number
    if (seen.has(id)) continue
    seen.add(id)
    const usage = readCompactionUsage(event.data.output)
    if (usage.accounting === 'auxiliary') rows.push(usage)
  }
  return { operations: rows.length, totals: Object.fromEntries(usageFields.map(key => [key,
    !rows.length || rows.some(row => row[key] === null) ? null : rows.reduce((sum, row) => sum + row[key]!, 0),
  ])) as Record<UsageField, number | null> }
}
