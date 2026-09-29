import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'gpt-compat': { kind: 'gpt-compat' } & ContextFormed
  }
}
