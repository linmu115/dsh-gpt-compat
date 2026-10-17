import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { PlainConfig, ResponsesAdapter } from '../src/responses.ts'
import type { NativeContextExtras } from '../src/auxiliary-usage.ts'
import { completed, serve, sse } from './responses-server.ts'

it.each(['responses', 'codex-v2'] as const)('returns auxiliary usage and checkpoint from exactly one %s request', async mode => {
  const server = await serve((_body, response) => {
    const value = completed([{ type: 'compaction', encrypted_content: 'fixture-checkpoint' }])
    if (mode === 'responses') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)) }
    else sse(response, value)
  })
  try {
    const config = PlainConfig({ providers: { fixture: { baseURL: server.url, apiKeyEnv: 'FIXTURE_KEY', nativeContextMode: mode,
      models: [{ id: 'gpt-fixture', contextWindow: 10000, maxTokens: 1000 }] } } })
    const adapter = new ResponsesAdapter(() => config, async () => 'fixture-key')
    const prepared = await adapter.prepareCall('fixture', 'gpt-fixture')
    const native = prepared.nativeContext! as typeof prepared.nativeContext & NativeContextExtras
    const message = createUserMessage({ content: [{ type: 'text', text: 'fixture' }], source: { kind: 'user' } })
    const result = await native.compactWithUsage!({ provider: 'fixture', model: 'gpt-fixture', messages: [] }, native.encode([message]))
    expect(result).toMatchObject({ accounting: 'auxiliary', usage: { inputTokens: 60, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 5, totalTokens: 120 } })
    expect(result.input.some(item => (item as any).encrypted_content === 'fixture-checkpoint')).toBe(true)
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.path).toBe(mode === 'codex-v2' ? '/v1/responses' : '/v1/responses/compact')
  } finally { await server.close() }
})
