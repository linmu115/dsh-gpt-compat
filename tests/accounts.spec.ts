import { expect, it, vi } from 'vitest'
import { CpaAccounts, normalizeQuota } from '../src/accounts/cpa.ts'

function fixture() {
  let selected = '', secret = 'management-secret'
  const rows = ['a', 'b'].map(id => ({ id, auth_index: id, name: id + '.json', email: id + '@example.com', provider: 'codex', source: 'file', disabled: false, id_token: { chatgpt_account_id: 'account-' + id, plan_type: 'plus' }, access_token: 'must-not-escape' }))
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.split('/management/')[1]!, body = JSON.parse(String(init?.body || '{}'))
    calls.push({ path, method: init?.method || 'GET', body })
    if (path === 'auth-files' && init?.method === 'DELETE') { const name = new URL(String(url)).searchParams.get('name'); rows.splice(rows.findIndex(a => a.name === name), 1); return Response.json({ status: 'ok' }) }
    if (path === 'auth-files') return Response.json({ files: rows })
    if (path === 'model-definitions/codex') return Response.json({ models: [
      { id: 'gpt-a', context_length: 272000, max_completion_tokens: 128000, thinking: { levels: ['low', 'high'] } },
      { id: 'gpt-b', context_length: 921000, max_completion_tokens: 128000 },
      { id: 'gpt-image-2' },
    ] })
    if (path === 'auth-files/models') return Response.json({ models: [{ id: new URL(String(url)).searchParams.get('name') === 'a.json' ? 'gpt-a' : 'gpt-b' }, { id: 'gpt-image-2' }] })
    if (path === 'routing/codex-account') {
      if (init?.method === 'PUT') { if (body.expected !== selected) return Response.json({}, { status: 409 }); selected = body.auth_index; return Response.json({ status: 'ok', auth_index: selected }) }
      return Response.json({ auth_index: selected, contract: 'codex-fixed-account/v1' })
    }
    if (path === 'auth-files/status') { rows.find(a => a.auth_index === body.auth_index)!.disabled = body.disabled; return Response.json({ status: 'ok' }) }
    if (path === 'api-call') return Response.json({ status_code: 200, body: JSON.stringify({ rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1900000000 }, secondary_window: { used_percent: null } } }) })
    if (path === 'codex-auth-url') return Response.json({ state: 'oauth-state', url: 'https://auth.openai.com/oauth/authorize?state=oauth-state' })
    if (path === 'get-auth-status') return Response.json({ status: 'ok' })
    throw new Error(path)
  })
  return { service: new CpaAccounts('http://127.0.0.1:8317', { get: async () => secret, set: async value => { secret = value } }, request as typeof fetch), rows, calls, request, selected: () => selected }
}

it('returns a sanitized account view and leaves standby accounts saved when pinning', async () => {
  const f = fixture(), before = await f.service.list()
  expect(JSON.stringify(before)).not.toMatch(/must-not-escape|id_token|account-a|\.json/)
  const after = await f.service.switch('b', before.revision)
  expect(after).toMatchObject({ selected: 'b', mode: 'fixed' })
  expect(f.rows.every(a => !a.disabled)).toBe(true)
  expect(f.calls.filter(c => c.method === 'PATCH')).toHaveLength(0)
  await expect(f.service.switch('a', before.revision)).rejects.toThrow('stale')
  expect(f.selected()).toBe('b')
})

it('discovers every available chat model and follows fixed account changes without changing accounts', async () => {
  const f = fixture()
  expect(await f.service.models('https://other.example/v1')).toBeUndefined()
  expect(await f.service.models('http://127.0.0.1:8317/v1')).toEqual([
    { id: 'gpt-a', contextWindow: 272000, maxTokens: 128000, reasoningEfforts: ['low', 'high'] },
    { id: 'gpt-b', contextWindow: 921000, maxTokens: 128000 },
  ])
  expect(f.calls.every(call => call.method === 'GET')).toBe(true)
  await f.service.switch('b', (await f.service.list()).revision)
  expect((await f.service.models('http://127.0.0.1:8317/v1'))?.map(model => model.id)).toEqual(['gpt-b'])
  await f.service.switch('paused', (await f.service.list()).revision)
  expect(await f.service.models('http://127.0.0.1:8317/v1')).toEqual([])
})

it('does not guess capacities when an available model has no metadata', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!
  f.request.mockImplementation(async (url, init) => String(url).includes('/model-definitions/') ? Response.json({ models: [] }) : original(url, init))
  await expect(f.service.models('http://127.0.0.1:8317/v1')).rejects.toThrow('missingModelCapacity')
})

it('keeps the new selection fail-closed if enabling that credential fails', async () => {
  const f = fixture(); f.rows[1]!.disabled = true
  const original = f.request.getMockImplementation()!
  f.request.mockImplementation(async (url, init) => String(url).endsWith('/status') ? Response.json({}, { status: 500 }) : original(url, init))
  await expect(f.service.switch('b', (await f.service.list()).revision)).rejects.toThrow('cpaFailed')
  expect(f.selected()).toBe('b')
  expect(f.rows[1]!.disabled).toBe(true)
})

it('pauses before removing the selected credential and never removes another account', async () => {
  const f = fixture(), before = await f.service.list()
  const pinned = await f.service.switch('a', before.revision)
  const after = await f.service.logout('a', pinned.revision)
  expect(after).toMatchObject({ selected: 'paused', mode: 'paused', accounts: [{ id: 'b' }] })
  expect(f.calls.filter(c => c.method === 'DELETE')).toHaveLength(1)
})

it('adds accounts without undoing a fixed selection; legacy routing is paused before OAuth', async () => {
  const f = fixture()
  const login = await f.service.login()
  expect(f.selected()).toBe('paused')
  expect(login.url).toMatch(/^https:\/\/auth.openai.com\//)
  await f.service.loginStatus(login.id)
  await f.service.switch('b', (await f.service.list()).revision)
  await f.service.login()
  expect(f.selected()).toBe('b')
})

it('queries quota for the explicit credential and preserves unknown values', async () => {
  const f = fixture(), quota = await f.service.quota('b')
  expect(quota.windows.map(w => w.remainingPercent)).toEqual([75, null])
  expect(f.calls.find(c => c.path === 'api-call')?.body).toMatchObject({ auth_index: 'b', url: 'https://chatgpt.com/backend-api/wham/usage' })
  expect(normalizeQuota('a', {}).windows).toEqual([])
})

it('does not silently fall back to a rotating pool when fixed routing is unsupported', async () => {
  const f = fixture(), original = f.request.getMockImplementation()!
  f.request.mockImplementation(async (url, init) => String(url).includes('/routing/') ? Response.json({}, { status: 404 }) : original(url, init))
  await expect(f.service.list()).rejects.toThrow('fixedUnsupported')
  expect(f.calls.some(c => c.method === 'PATCH')).toBe(false)
})
