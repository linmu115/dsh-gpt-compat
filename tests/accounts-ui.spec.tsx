// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Accounts, accountEn } from '../src/client/Accounts.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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
  expect(requests.every(r => r.action === 'list')).toBe(true)
})
