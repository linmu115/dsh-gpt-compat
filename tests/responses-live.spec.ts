/** Explicitly opt-in live check; ordinary development tests never call a paid endpoint. */
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Config, ResponsesAdapter } from '../src/responses.ts'

it.skipIf(process.env.GPT_COMPAT_LIVE_TEST !== '1')('accepts a real Responses text request with a replay envelope', async () => {
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Set ${name} for the explicit live check`); return value }
  const model = required('GPT_COMPAT_LIVE_MODEL')
  const config = Config({ providers: { live: {
    baseURL: required('GPT_COMPAT_LIVE_URL'), apiKeyEnv: 'GPT_COMPAT_LIVE_KEY',
    models: [{ id: model, contextWindow: Number(required('GPT_COMPAT_LIVE_CONTEXT')), maxTokens: 1024 }],
  } } })
  const adapter = new ResponsesAdapter(() => config, async () => required('GPT_COMPAT_LIVE_KEY'))
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'live', model, maxTokens: 1024, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply with the single word OK.' }], source: { kind: 'user' } })] })) chunks.push(chunk)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' }, replayState: { response: { kind: 'dsh-gpt-responses' } } })
}, 300000)
