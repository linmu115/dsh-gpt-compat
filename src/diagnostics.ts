import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from './accounts/host.ts'
import type { Config as ProviderConfig } from './responses.ts'
import type { Config } from './config.ts'

export interface ProviderDiagnostic {
  provider: string
  mode: string
  models: { id: string; contextWindow: number; maxTokens: number; reasoningEfforts: string[] }[]
  capabilityEvidence: 'configured'
  serverCompaction: 'not-enabled' | 'not-verified'
  responseAccounting: 'ordinary-response-includes-inline-compaction' | 'ordinary-response'
  fixedAccount: 'verified' | 'paused' | 'not-checked' | 'unavailable' | 'unauthorized' | 'unsupported' | 'unknown'
  cpa: 'running' | 'unavailable' | 'not-checked'
}
export interface DiagnosticSnapshot {
  version: 1
  checkedAt: number
  contextEnabled: boolean
  bindingCount: number
  providerState: 'available' | 'unavailable'
  providers: ProviderDiagnostic[]
  credential: 'not-inspected'
  modelRequest: 'not-performed'
}
declare module '@deepseek-ai/cordis' {
  interface Context { gptResponsesDiagnostics: { read(signal: AbortSignal): Promise<ProviderDiagnostic[]> } }
}
const safeText = (value: unknown) => typeof value === 'string' ? value.slice(0, 160) : ''
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0

async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let cancel!: () => void
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      cancel = () => reject(new Error('diagnostic-timeout'))
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })])
  } finally { signal.removeEventListener('abort', cancel) }
}

/** Public CPA identity only. Never send a credential, redirect, model request, or process command. */
export async function probeCpa(endpoint: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<ProviderDiagnostic['cpa']> {
  let url: URL
  try { url = new URL(endpoint) } catch { return 'not-checked' }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) return 'not-checked'
  try {
    const response = await request(url.origin, { redirect: 'error', signal })
    const reader = response.body?.getReader()
    if (!reader) return 'unavailable'
    let size = 0, text = ''
    const decoder = new TextDecoder()
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 16384) return 'unavailable'
        text += decoder.decode(part.value, { stream: true })
      }
      text += decoder.decode()
      return response.ok && JSON.parse(text)?.message === 'CLI Proxy API Server' ? 'running' : 'unavailable'
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } catch { return 'unavailable' }
}

/** Identity is consumed only as a protocol result; account identifiers never enter the snapshot. */
export async function readProviderDiagnostics(config: ProviderConfig, identity: ((endpoint: string) => Promise<string | undefined>) | undefined,
  signal: AbortSignal, probe: typeof probeCpa = probeCpa): Promise<ProviderDiagnostic[]> {
  return Promise.all(Object.entries(config.providers).slice(0, 20).map(async ([provider, profile]) => {
    let fixedAccount: ProviderDiagnostic['fixedAccount'] = 'not-checked'
    if (identity) {
      try {
        const selected = await bounded(identity(profile.baseURL), signal)
        fixedAccount = selected === undefined || selected === '' ? 'unknown' : selected === 'paused' ? 'paused' : 'verified'
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        fixedAccount = code === 'unauthorized' ? 'unauthorized' : code === 'fixedUnsupported' ? 'unsupported' : 'unavailable'
      }
    }
    const mode = safeText(profile.nativeContextMode)
    return {
      provider: safeText(provider), mode,
      models: profile.models.slice(0, 200).map(model => ({ id: safeText(model.id), contextWindow: count(model.contextWindow),
        maxTokens: count(model.maxTokens), reasoningEfforts: (model.reasoningEfforts ?? []).slice(0, 20).map(safeText) })),
      capabilityEvidence: 'configured' as const,
      serverCompaction: mode === 'responses-server' ? 'not-verified' as const : 'not-enabled' as const,
      responseAccounting: mode === 'responses-server' ? 'ordinary-response-includes-inline-compaction' as const : 'ordinary-response' as const,
      fixedAccount, cpa: await probe(profile.baseURL, signal),
    }
  }))
}

/** Called by the provider plugin; no settings or credential values are exposed through this service. */
export function installResponsesDiagnostics(ctx: Context, source: () => ProviderConfig): void {
  const pending = new Map<string, Promise<string | undefined>>()
  ctx.provide('gptResponsesDiagnostics', { read: signal => {
    const account = ctx.get('gptCpaAccounts')
    const identity = account ? (endpoint: string) => {
      let work = pending.get(endpoint)
      if (!work) {
        work = account.identity(endpoint).finally(() => { pending.delete(endpoint) })
        pending.set(endpoint, work)
      }
      return work
    } : undefined
    return readProviderDiagnostics(structuredClone(source()), identity, signal)
  } })
}

export async function handleDiagnostics(source: () => Config, providers: ((signal: AbortSignal) => Promise<ProviderDiagnostic[]>) | undefined, request: Request): Promise<Response> {
  const headers = { 'cache-control': 'no-store' }
  if (request.method !== 'GET' || new URL(request.url).search) return new Response(null, { status: 400, headers })
  try {
    const config = source()
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(3000)])
    const snapshot: DiagnosticSnapshot = { version: 1, checkedAt: Date.now(), contextEnabled: config.context.enabled,
      bindingCount: config.bindings.length, providerState: providers ? 'available' : 'unavailable',
      providers: providers ? await bounded(providers(signal), signal) : [], credential: 'not-inspected', modelRequest: 'not-performed' }
    return Response.json({ ok: true, value: snapshot }, { headers })
  } catch { return Response.json({ ok: false, code: 'diagnosticsUnavailable' }, { status: 503, headers }) }
}

/** Connection owns authentication and Host/Origin checks, as on the existing progress/accounts routes. */
export function installDiagnostics(ctx: Context, source: () => Config): void {
  ctx.inject(['connection'], c => c.effect(() => c.connection.fetch.register({
    path: '/api/gpt-compat.diagnostics', methods: ['GET'], requestBody: 'buffered',
    fetch: request => handleDiagnostics(source, ctx.get('gptResponsesDiagnostics')?.read, request),
  })))
}
