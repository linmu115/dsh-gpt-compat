// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Bindings, type Props } from '../src/client/Bindings.tsx'

afterEach(cleanup)
function props(save = vi.fn().mockResolvedValue(undefined)): Props {
  return { t: (key: string) => key, save,
    useBindings: (select: (value: unknown) => unknown) => select({
      status: 'ready', writable: true, revision: 7, value: { bindings: [{ provider: 'cpa', models: ['gpt-*'] }] },
    }),
  } as unknown as Props
}

it('saves provider/model bindings with the draft revision', async () => {
  const input = props()
  render(<Bindings {...input} />)
  fireEvent.change(screen.getByLabelText('provider 1'), { target: { value: 'my-cpa' } })
  fireEvent.change(screen.getByLabelText('models 1'), { target: { value: 'gpt-5, gpt-6*' } })
  fireEvent.click(screen.getByText('save'))
  await waitFor(() => expect(input.save).toHaveBeenCalledWith([{ provider: 'my-cpa', models: ['gpt-5', 'gpt-6*'] }], 7))
})

it('keeps a refused draft and lets the user remove every binding', async () => {
  const save = vi.fn().mockRejectedValue(new Error('revision conflict'))
  render(<Bindings {...props(save)} />)
  fireEvent.change(screen.getByLabelText('provider 1'), { target: { value: 'new-provider' } })
  fireEvent.click(screen.getByText('save'))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'revision conflict')
  expect(screen.getByLabelText('provider 1')).toHaveProperty('value', 'new-provider')
  save.mockResolvedValue(undefined)
  fireEvent.click(screen.getByText('remove'))
  fireEvent.click(screen.getByText('save'))
  await waitFor(() => expect(save).toHaveBeenLastCalledWith([], 7))
})
