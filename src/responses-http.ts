/** Bounded HTTP/SSE transport shared by Responses generation and explicit compaction. */
import { attributionHeaders, CONTEXT_WINDOW_EXCEEDED_CODE, QUOTA_EXCEEDED_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import { record, type Item } from './responses-wire.ts'

export interface Connection {
  accountIdentity?: string
  baseURL: string
  apiKey: string
  timeoutMs: number
  maxResponseBytes: number
}

function providerFailure(value: unknown, status?: number, retryAfter?: string | null): LlmError {
  const error = record(value) && record(value.error) ? value.error : value
  const code = record(error) ? error.code : undefined
  const type = record(error) ? error.type : undefined
  const quota = [code, type].some(value => value === 'insufficient_quota' || value === 'usage_limit_reached')
  const kind = code === 'context_length_exceeded' || code === 'context_window_exceeded' ? CONTEXT_WINDOW_EXCEEDED_CODE
    : quota ? QUOTA_EXCEEDED_CODE : status === 429 ? 'RATE_LIMIT' : 'RESPONSES_GENERATION_FAILED'
  const delay = retryAfter ? Number(retryAfter) * 1000 : NaN
  return new LlmError(status ? `Responses HTTP ${status}` : 'Responses generation failed', kind, {
    ...status === undefined ? {} : { status },
    ...Number.isFinite(delay) && delay > 0 && delay <= 2147483647 ? { providerRetryAfterMs: delay } : {},
  })
}

/** Error bodies can echo prompts or credentials; inspect only bounded structured codes, never log their text. */
async function errorBody(response: Response): Promise<unknown> {
  if (!response.body) return undefined
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 16384) return undefined
      parts.push(part.value)
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return undefined }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** One attempt only; DSH owns visible retries. Redirects cannot carry a key elsewhere. */
export async function post(connection: Connection, path: 'responses' | 'responses/compact' | 'responses/input_tokens', body: Item, signal?: AbortSignal): Promise<Item> {
  const timeout = AbortSignal.timeout(connection.timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  combined.throwIfAborted()
  const response = await fetch(`${connection.baseURL.replace(/\/+$/, '')}/${path}`, {
    method: 'POST', redirect: 'error', signal: combined,
    headers: { ...attributionHeaders(), ...(connection.accountIdentity ? { 'X-CPA-Codex-Account': connection.accountIdentity } : {}), authorization: `Bearer ${connection.apiKey}`, 'content-type': 'application/json', accept: body.stream ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    if ((response.status === 404 || response.status === 501) && path !== 'responses') {
      await response.body?.cancel()
      const counting = path === 'responses/input_tokens'
      throw new LlmError(`Responses HTTP ${response.status}: native ${counting ? 'token counting' : 'compaction'} is unavailable on this endpoint`,
        counting ? 'NATIVE_COUNT_UNAVAILABLE' : 'NATIVE_COMPACTION_UNAVAILABLE', { status: response.status })
    }
    throw providerFailure(await errorBody(response), response.status, response.headers.get('retry-after'))
  }
  if (!response.body) throw new LlmError('Responses returned no body', 'EMPTY_RESPONSE')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sse = response.headers.get('content-type')?.includes('text/event-stream') === true
  let size = 0, buffer = '', terminal: Item | undefined
  const event = (frame: string) => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    const value: unknown = JSON.parse(data)
    if (!record(value)) throw new LlmError('Invalid Responses event', 'INVALID_RESPONSES_PAYLOAD')
    if (value.type === 'response.failed' || value.type === 'error') throw providerFailure(record(value.response) ? value.response : value)
    if (value.type === 'response.completed' || value.type === 'response.incomplete') {
      if (terminal || !record(value.response)) throw new LlmError('Invalid Responses terminal event', 'INVALID_RESPONSES_PAYLOAD')
      terminal = value.response
    }
  }
  try {
    while (true) {
      const part = await reader.read()
      combined.throwIfAborted()
      if (part.done) break
      size += part.value.byteLength
      if (size > connection.maxResponseBytes) throw new LlmError('Responses body exceeds configured limit', 'RESPONSES_SIZE_LIMIT')
      buffer += decoder.decode(part.value, { stream: true })
      if (sse) {
        buffer = buffer.replace(/\r\n/g, '\n')
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2)
        }
        // A terminal event owns the result; an open keep-alive must not stall tool execution.
        if (terminal) break
      }
    }
    buffer += decoder.decode()
    if (sse && buffer.trim()) event(buffer.replace(/\r\n/g, '\n'))
    if (!sse) { const value: unknown = JSON.parse(buffer); if (record(value)) terminal = value }
    if (!terminal) throw new LlmError('Responses stream ended before a terminal response', 'RESPONSES_TRUNCATED')
    return terminal
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
