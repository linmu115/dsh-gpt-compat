// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Accounts, accountEn, accountZh } from '../src/client/Accounts.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('offers startup while account listing is offline and refreshes accounts after readiness', async () => {
  let running = false
  const requests: string[] = []
  let finish!: () => void
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { action } = JSON.parse(init.body); requests.push(action)
    if (action === 'localStart') { await new Promise<void>(resolve => { finish = resolve }); running = true }
    if (action === 'localStatus' || action === 'localStart') return Response.json({ ok: true, value: { state: running ? 'running' : 'stopped', canStart: true } })
    if (!running) return Response.json({ ok: false, code: 'unreachable' })
    return Response.json({ ok: true, value: { configured: true, mode: 'paused', revision: 'r1', accounts: [] } })
  }))
  render(<Accounts t={key => accountEn[key]} />)
  await screen.findByText('CPA is not running')
  fireEvent.click(screen.getByText('Start local CPA'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Starting CPA…' }).hasAttribute('disabled')).toBe(true))
  finish()
  await screen.findByText('CPA is running')
  await screen.findByText('No Codex accounts are signed in.')
  expect(requests.filter(action => action === 'localStart')).toHaveLength(1)
  expect(screen.getByText('Start local CPA').hasAttribute('disabled')).toBe(true)
  expect(screen.queryByText(accountEn.unreachable)).toBeNull()
})

it('explains an old running backend instead of leaving a permanently checking status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, code: 'invalidInput' })))
  render(<Accounts t={key => accountEn[key]} />)
  await screen.findByText(accountEn.localUpgradeRequired)
  expect(screen.queryByText(accountEn.localChecking)).toBeNull()
  expect(screen.getByText(accountEn.localStart).hasAttribute('disabled')).toBe(true)
})

it('asks for confirmation before switching and sends the rendered pool revision', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const snapshot = { configured: true, endpoint: 'http://127.0.0.1:8317', mode: 'fixed', selected: 'a', revision: 'pool-7', accounts: [
    { id: 'a', label: 'First account', canLogout: true, disabled: false }, { id: 'b', label: 'Second account', canLogout: true, disabled: false },
  ] }
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    if (body.action === 'quota') return Response.json({ ok: false, code: 'quotaUnavailable' })
    return Response.json({ ok: true, value: snapshot })
  }))
  render(<Accounts t={key => accountEn[key]} />)
  await screen.findByText('Second account')
  fireEvent.click(screen.getAllByText('Use this account')[1]!)
  expect(requests.some(r => r.action === 'switch')).toBe(false)
  expect(screen.getByRole('alertdialog').textContent).toContain('Second account')
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() => expect(requests).toContainEqual({ action: 'switch', id: 'b', revision: 'pool-7' }))
  expect(screen.queryByText('0% remaining')).toBeNull()
})

it('keeps sign-out tied to the named account and cancellation does not mutate CPA', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    return Response.json({ ok: true, value: { configured: true, mode: 'paused', selected: 'paused', revision: 'r1', accounts: [{ id: 'b', label: 'Standby account', canLogout: true }] } })
  }))
  render(<Accounts t={key => accountEn[key]} />)
  fireEvent.click(await screen.findByText('Remove and sign out'))
  expect(screen.getByRole('alertdialog').textContent).toContain('Standby account')
  fireEvent.click(screen.getByText('Cancel'))
  expect(requests.every(r => r.action === 'list' || r.action === 'localStatus')).toBe(true)
})

it.each([accountEn, accountZh])('explains an unavailable account authentication failure without automatically signing in', async language => {
  const actions: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { action } = JSON.parse(init.body); actions.push(action)
    if (action === 'localStatus') return Response.json({ ok: true, value: { state: 'running', canStart: false } })
    return Response.json({ ok: true, value: { configured: true, mode: 'paused', selected: 'paused', revision: 'r1', accounts: [
      { id: 'b', label: 'Expired account', canLogout: true, unavailable: true, unavailableReason: 'authentication' },
    ] } })
  }))
  render(<Accounts t={key => language[key]} />)
  await screen.findByText(language.accountAuthentication)
  expect(screen.getByText(language.accountUnavailable)).toBeTruthy()
  expect(screen.queryByText(language.unauthorized)).toBeNull()
  expect(actions.every(action => action === 'list' || action === 'localStatus')).toBe(true)
})

it.each([undefined, 'PRIVATE_UNKNOWN_REASON'])('keeps old and unknown unavailable reasons generic: %s', async unavailableReason => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { action } = JSON.parse(init.body)
    if (action === 'localStatus') return Response.json({ ok: true, value: { state: 'running', canStart: false } })
    return Response.json({ ok: true, value: { configured: true, mode: 'paused', selected: 'paused', revision: 'r1', accounts: [
      { id: 'b', label: 'Unknown account', canLogout: true, unavailable: true, unavailableReason },
    ] } })
  }))
  render(<Accounts t={key => accountEn[key]} />)
  await screen.findByText(accountEn.accountUnavailable)
  expect(screen.queryByText(accountEn.accountAuthentication)).toBeNull()
  expect(screen.queryByText('PRIVATE_UNKNOWN_REASON')).toBeNull()
  expect(screen.getByText(accountEn.quotaUnknown)).toBeTruthy()
})

it.each(['accountAuthentication', 'unauthorized', 'quotaUnavailable', 'PRIVATE_RAW_ERROR'])('renders the safe quota failure message for %s', async code => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { action } = JSON.parse(init.body)
    if (action === 'localStatus') return Response.json({ ok: true, value: { state: 'running', canStart: false } })
    if (action === 'quota') return Response.json({ ok: false, code })
    return Response.json({ ok: true, value: { configured: true, mode: 'fixed', selected: 'b', revision: 'r1', accounts: [
      { id: 'b', label: 'Selected account', canLogout: true, disabled: false },
    ] } })
  }))
  render(<Accounts t={key => accountEn[key]} />)
  await screen.findByText(accountEn[code === 'PRIVATE_RAW_ERROR' ? 'accountError' : code as keyof typeof accountEn])
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByText('0% remaining')).toBeNull()
  expect(screen.queryByText('PRIVATE_RAW_ERROR')).toBeNull()
  if (code !== 'unauthorized') expect(screen.queryByText(accountEn.unauthorized)).toBeNull()
  expect(screen.queryByRole('button', { name: accountEn.accountRelogin }) !== null).toBe(code === 'accountAuthentication')
})

function reloginFixture({ selected = 'b', reason = true, mode = 'fixed' }: { selected?: string; reason?: boolean; mode?: string } = {}) {
  const requests: { action: string; id?: string }[] = []
  const signals: AbortSignal[] = []
  const state = { status: 'wait', quotaError: 'accountAuthentication', removeTarget: false, loginError: '', stallStatus: false }
  const target = { id: 'b', label: 'Target account', canLogout: true, disabled: false, unavailable: reason, ...(reason ? { unavailableReason: 'authentication' } : {}) }
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    if (body.action === 'localStatus') return Response.json({ ok: true, value: { state: 'running', canStart: false } })
    if (body.action === 'login') return state.loginError ? Response.json({ ok: false, code: state.loginError }) : Response.json({ ok: true, value: { id: 'oauth-fixture', url: 'https://auth.openai.com/fixture' } })
    if (body.action === 'loginStatus') {
      signals.push(init.signal)
      if (state.stallStatus) return new Promise<Response>(() => {})
      return state.status === 'loginExpired' ? Response.json({ ok: false, code: 'loginExpired' }) : Response.json({ ok: true, value: { status: state.status } })
    }
    if (body.action === 'quota') return state.quotaError && body.id === 'b' ? Response.json({ ok: false, code: state.quotaError }) : Response.json({ ok: true, value: {
      accountId: body.id, checkedAt: '2026-10-06T12:00:00Z', windows: [{ name: 'main/primary_window', remainingPercent: 70, usedPercent: 30, durationMinutes: 300, resetsAt: null }],
    } })
    return Response.json({ ok: true, value: { configured: true, mode, selected, revision: 'r1', accounts: [
      { id: 'a', label: 'Other account', canLogout: true, disabled: false }, ...(state.removeTarget ? [] : [target]),
    ] } })
  }))
  return { requests, signals, state }
}

async function startRelogin() {
  const button = await screen.findByRole('button', { name: accountEn.accountRelogin })
  vi.useFakeTimers()
  await act(async () => { fireEvent.click(button) })
  expect(screen.getByRole('link', { name: accountEn.openLogin })).toBeTruthy()
}

it.each([
  { selected: 'a', reason: true }, { selected: 'b', reason: true }, { selected: 'b', reason: false },
])('offers targeted re-login for selected=$selected and backend reason=$reason without changing routing', async options => {
  const f = reloginFixture(options)
  render(<Accounts t={key => accountEn[key]} />)
  const button = await screen.findByRole('button', { name: accountEn.accountRelogin })
  expect(button.hasAttribute('disabled')).toBe(false)
  expect(f.requests.some(request => request.action === 'login')).toBe(false)
  fireEvent.click(button); fireEvent.click(button)
  const link = await screen.findByRole('link', { name: accountEn.openLogin })
  const card = screen.getByText('Target account').closest('.gpt-compat-settings__card') as HTMLElement
  expect(within(card).getByRole('link', { name: accountEn.openLogin })).toBe(link)
  expect(card.textContent).toContain(accountEn.reloginWaiting)
  expect(screen.queryByText(accountEn.loginWaiting)).toBeNull()
  expect(f.requests.filter(request => request.action === 'login')).toEqual([{ action: 'login' }])
  expect(f.requests.some(request => ['switch', 'logout'].includes(request.action))).toBe(false)
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: accountEn.accountAdd }).hasAttribute('disabled')).toBe(true)
})

it('verifies only the target quota after OAuth completes before reporting success', async () => {
  const f = reloginFixture({ selected: 'a' })
  render(<Accounts t={key => accountEn[key]} />)
  await startRelogin()
  f.state.status = 'ok'; f.state.quotaError = ''
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(screen.getByText(`Target account：${accountEn.reloginVerified}`)).toBeTruthy()
  expect(f.requests.slice(-3)).toEqual([{ action: 'loginStatus', id: 'oauth-fixture' }, { action: 'list' }, { action: 'quota', id: 'b' }])
  expect(screen.queryByRole('link', { name: accountEn.openLogin })).toBeNull()
  expect(screen.queryByText(accountEn.loginDone)).toBeNull()
  expect(f.requests.some(request => ['switch', 'logout'].includes(request.action))).toBe(false)
})

it('waits for the target quota response rather than declaring success at the OAuth callback', async () => {
  const f = reloginFixture({ selected: 'a' })
  render(<Accounts t={key => accountEn[key]} />)
  await startRelogin()
  f.state.status = 'ok'; f.state.quotaError = ''
  const original = globalThis.fetch
  let finish!: () => void
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (JSON.parse(String(init?.body)).action === 'quota') await new Promise<void>(resolve => { finish = resolve })
    return original(url, init)
  }))
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(screen.getByText(`Target account：${accountEn.reloginChecking}`)).toBeTruthy()
  expect(screen.queryByText(`Target account：${accountEn.reloginVerified}`)).toBeNull()
  await act(async () => { finish() })
  expect(screen.getByText(`Target account：${accountEn.reloginVerified}`)).toBeTruthy()
})

it('offers re-login for a standby account after its explicit quota refresh reports authentication failure', async () => {
  reloginFixture({ selected: 'a', reason: false })
  render(<Accounts t={key => accountEn[key]} />)
  const target = (await screen.findByText('Target account')).closest('.gpt-compat-settings__card') as HTMLElement
  expect(within(target).queryByRole('button', { name: accountEn.accountRelogin })).toBeNull()
  fireEvent.click(within(target).getByRole('button', { name: accountEn.refreshQuota }))
  const button = await within(target).findByRole('button', { name: accountEn.accountRelogin })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
})

it('preserves the global Add account flow and its completion message', async () => {
  const f = reloginFixture()
  render(<Accounts t={key => accountEn[key]} />)
  await screen.findByText('Target account')
  vi.useFakeTimers()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: accountEn.accountAdd })) })
  expect(screen.getByText(accountEn.loginWaiting)).toBeTruthy()
  expect(screen.queryByText(`Target account：${accountEn.reloginWaiting}`)).toBeNull()
  f.state.status = 'ok'
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(screen.getByText(accountEn.loginDone)).toBeTruthy()
  expect(f.requests.filter(request => request.action === 'login')).toEqual([{ action: 'login' }])
  expect(f.requests.some(request => ['switch', 'logout'].includes(request.action))).toBe(false)
})

it.each(['accountAuthentication', 'quotaUnavailable'])('does not claim the target recovered on OAuth success with target quota error %s', async quotaError => {
  const f = reloginFixture()
  render(<Accounts t={key => accountEn[key]} />)
  await startRelogin()
  f.state.status = 'ok'; f.state.quotaError = quotaError
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(screen.getByText(`Target account：${accountEn.reloginUnverified} ${accountEn[quotaError as keyof typeof accountEn]}`)).toBeTruthy()
  expect(screen.queryByText(new RegExp(accountEn.reloginVerified))).toBeNull()
  expect(screen.getByRole('button', { name: accountEn.accountRelogin }).hasAttribute('disabled')).toBe(false)
})

it('retains target context if it disappears after a successful OAuth callback', async () => {
  const f = reloginFixture({ selected: 'a' })
  render(<Accounts t={key => accountEn[key]} />)
  await startRelogin()
  f.state.status = 'ok'; f.state.removeTarget = true
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(screen.getByText(`Target account：${accountEn.reloginMissing}`)).toBeTruthy()
  expect(f.requests.filter(request => request.action === 'quota' && request.id === 'b')).toHaveLength(0)
})

it.each(['error', 'loginExpired'])('ends the pending target flow on %s and permits an explicit retry', async status => {
  const f = reloginFixture()
  render(<Accounts t={key => accountEn[key]} />)
  await startRelogin()
  f.state.status = status
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(screen.getByText(`Target account：${accountEn.reloginUnverified} ${status === 'error' ? accountEn.loginFailed : accountEn.loginExpired}`)).toBeTruthy()
  expect(screen.queryByRole('link', { name: accountEn.openLogin })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: accountEn.accountRelogin }))
  await act(async () => {})
  expect(f.requests.filter(request => request.action === 'login')).toHaveLength(2)
})

it('keeps a failed login-start error in the target card and does not leak raw messages', async () => {
  const f = reloginFixture(); f.state.loginError = 'PRIVATE_LOGIN_FAILURE'
  render(<Accounts t={key => accountEn[key]} />)
  fireEvent.click(await screen.findByRole('button', { name: accountEn.accountRelogin }))
  await screen.findByText(`Target account：${accountEn.reloginUnverified} ${accountEn.accountError}`)
  expect(screen.queryByText('PRIVATE_LOGIN_FAILURE')).toBeNull()
  expect(screen.getByRole('button', { name: accountEn.accountRelogin }).hasAttribute('disabled')).toBe(false)
})

it('does not invoke the legacy login API that would pause routing', async () => {
  const f = reloginFixture({ selected: '', mode: 'legacy' })
  render(<Accounts t={key => accountEn[key]} />)
  const button = await screen.findByRole('button', { name: accountEn.accountRelogin })
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(accountEn.reloginLegacy)).toBeTruthy()
  fireEvent.click(button)
  expect(f.requests.some(request => request.action === 'login')).toBe(false)
})

it('aborts an in-flight target poll and clears timers on unmount', async () => {
  const f = reloginFixture()
  const view = render(<Accounts t={key => accountEn[key]} />)
  await startRelogin(); f.state.stallStatus = true
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(f.signals).toHaveLength(1)
  view.unmount()
  expect(f.signals[0]!.aborted).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(310_000) })
  expect(f.requests.filter(request => request.action === 'loginStatus')).toHaveLength(1)
})

it('expires a stalled target flow locally without claiming success', async () => {
  const f = reloginFixture()
  render(<Accounts t={key => accountEn[key]} />)
  await startRelogin(); f.state.stallStatus = true
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
  expect(f.signals[0]!.aborted).toBe(true)
  expect(screen.getByText(`Target account：${accountEn.reloginUnverified} ${accountEn.loginExpired}`)).toBeTruthy()
  expect(screen.getByRole('button', { name: accountEn.accountRelogin }).hasAttribute('disabled')).toBe(false)
})
