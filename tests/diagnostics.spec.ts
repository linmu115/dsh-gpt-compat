import { expect, it, vi } from 'vitest'
import { handleDiagnostics, probeCpa, readProviderDiagnostics } from '../src/diagnostics.ts'
import { Config } from '../src/config.ts'
const source = (mode = 'codex-v2') => ({ providers: { fixture: { baseURL: 'http://127.0.0.1:8317/v1', apiKeyEnv: 'PRIVATE_KEY_REFERENCE', nativeContextMode: mode,
  models: [{ id: 'gpt-fixture', contextWindow: 1000, maxTokens: 100, reasoningEfforts: ['high'] }], opaque: 'PRIVATE_OPAQUE' } } }) as any

it('separates configuration from support and strips private account/credential data', async () => {
  const identity = vi.fn(async () => 'PRIVATE_ACCOUNT_ID')
  const result = await readProviderDiagnostics(source('responses-server'), identity, new AbortController().signal, async () => 'running')
  expect(result[0]).toMatchObject({ capabilityEvidence: 'configured', fixedAccount: 'verified', cpa: 'running', serverCompaction: 'not-verified', responseAccounting: 'ordinary-response-includes-inline-compaction' })
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|baseURL|apiKeyEnv|opaque/)
  expect(identity).toHaveBeenCalledOnce()
})

it.each([['unauthorized', 'unauthorized'], ['fixedUnsupported', 'unsupported'], ['something PRIVATE', 'unavailable']])('reports safe protocol state for %s without forwarding error bodies', async (code, expected) => {
  const result = await readProviderDiagnostics(source(), async () => { throw Object.assign(new Error('PRIVATE_BODY'), { code }) }, new AbortController().signal, async () => 'running')
  expect(result[0]?.fixedAccount).toBe(expected)
  expect(result[0]?.serverCompaction).toBe('not-enabled')
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
})

it('a CPA identity probe is local, public, bounded in bytes and never follows redirects or passes keys', async () => {
  const request = vi.fn(async () => Response.json({ message: 'CLI Proxy API Server' }))
  const signal = new AbortController().signal
  expect(await probeCpa('https://remote.example/v1', signal, request)).toBe('not-checked')
  expect(request).not.toHaveBeenCalled()
  expect(await probeCpa('http://127.0.0.1:8317/v1', signal, request)).toBe('running')
  expect(request).toHaveBeenCalledWith('http://127.0.0.1:8317', { redirect: 'error', signal })
  expect(await probeCpa('http://127.0.0.1:8317', signal, async () => new Response('x'.repeat(16385)))).toBe('unavailable')
})

it('only serves a no-store read without disclosing config bindings or invoking a model', async () => {
  const providers = vi.fn(async () => [])
  const response = await handleDiagnostics(() => Config({ bindings: [{ provider: 'PRIVATE', models: ['gpt-*'] }] }), providers, new Request('http://local/api/gpt-compat.diagnostics'))
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json()
  expect(body.value).toMatchObject({ bindingCount: 1, credential: 'not-inspected', modelRequest: 'not-performed' })
  expect(JSON.stringify(body)).not.toContain('PRIVATE')
  expect((await handleDiagnostics(() => Config({}), providers, new Request('http://local/api?key=PRIVATE'))).status).toBe(400)
  expect((await handleDiagnostics(() => Config({}), providers, new Request('http://local/api', { method: 'POST' }))).status).toBe(400)
  expect(providers).toHaveBeenCalledOnce()
})

it('fails safely on cancellation and does not echo the provider error', async () => {
  const response = await handleDiagnostics(() => Config({}), async () => { throw new Error('PRIVATE') }, new Request('http://local/api'))
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ ok: false, code: 'diagnosticsUnavailable' })
})
