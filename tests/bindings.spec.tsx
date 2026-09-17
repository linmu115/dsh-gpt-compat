// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Bindings, type Props } from '../src/client/Bindings.tsx'
vi.mock('../src/client/Accounts.tsx', () => ({ Accounts: () => null }))
afterEach(cleanup)
function props(loadModels = vi.fn().mockResolvedValue([{ id: 'cpa', name: 'cpa', models: [{ id: 'gpt-a', name: 'gpt-a' }] }])): Props {
  return { t: (key: string) => key, loadModels,
    useProviders: (select: (value: unknown) => unknown) => select({
      status: 'ready', writable: true, revision: 7, value: { providers: { cpa: {} } },
    }),
  } as unknown as Props
}
it('loads models automatically and provides no model or provider editing controls', async () => {
  const input = props(), view = render(<Bindings {...input} />)
  expect(await screen.findByText('gpt-a')).toBeTruthy()
  expect(input.loadModels).toHaveBeenCalledWith(['cpa'])
  expect(view.container.querySelector('input,textarea,select,[role=combobox]')).toBeNull()
  expect(screen.queryByText('save')).toBeNull()
  fireEvent.click(screen.getByText('refreshModels'))
  await waitFor(() => expect(input.loadModels).toHaveBeenCalledTimes(2))
})
it('shows a failed discovery and can retry without keeping a stale success list', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([])
  render(<Bindings {...props(load)} />)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'failedModels')
  fireEvent.click(screen.getByText('refreshModels'))
  expect(await screen.findByText('emptyModels')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
